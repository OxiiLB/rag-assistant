import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import type { ChatTurn, SearchHit, SourceRef } from '../types.ts';
import { embedQuery } from './embeddings.ts';
import { LexicalIndex } from './lexical.ts';
import { vectorStore } from './vector-store.ts';

const client = new Anthropic();

/** RRF damping constant; 60 is the value from the original Cormack et al. paper. */
const RRF_K = 60;

const SYSTEM_PROMPT = `Tu es un assistant documentaire. Tu réponds aux questions des utilisateurs en t'appuyant EXCLUSIVEMENT sur les extraits de documents fournis dans le message (bloc SOURCES).

Règles :
- Réponds dans la langue de la question (français par défaut).
- Chaque affirmation tirée d'une source doit être suivie de sa citation au format [n], où n est le numéro de la source. Exemple : "Le budget est de 20 €/mois [2]."
- Si plusieurs sources appuient une affirmation, cite-les toutes : [1][3].
- Si les sources ne contiennent pas l'information demandée, dis-le clairement et ne réponds pas de mémoire. N'invente jamais de citation.
- Sois concis et structuré. Utilise **gras** pour les points clés et des listes à puces quand c'est pertinent.
- Pour les questions de suivi, appuie-toi sur l'historique de la conversation ET sur les nouvelles sources fournies.`;

const lexicalIndex = new LexicalIndex();
let indexedRevision = -1;

/** Rebuilds the keyword index whenever documents have been added or removed. */
async function ensureLexicalIndex(): Promise<void> {
  if (vectorStore.revision === indexedRevision) return;
  lexicalIndex.build(await vectorStore.listChunks());
  indexedRevision = vectorStore.revision;
}

/**
 * Hybrid retrieval: dense (embeddings) and sparse (BM25) run independently, then
 * Reciprocal Rank Fusion merges the two rankings. RRF only looks at positions, so
 * it needs no score calibration between two incomparable scales — and a passage
 * ranked well by either retriever surfaces.
 */
export async function retrieve(question: string): Promise<{ hits: SearchHit[]; sources: SourceRef[] }> {
  await ensureLexicalIndex();
  const candidates = config.topK * 3;

  const vector = await embedQuery(question);
  const [dense, lexical] = await Promise.all([
    vectorStore.search(vector, candidates),
    Promise.resolve(lexicalIndex.search(question, candidates)),
  ]);

  const fused = new Map<string, { chunk: SearchHit['chunk']; score: number; dense: number }>();
  const fuse = (ranking: { chunk: SearchHit['chunk']; score: number }[], isDense: boolean) => {
    ranking.forEach((entry, rank) => {
      const existing = fused.get(entry.chunk.id);
      const contribution = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.score += contribution;
        if (isDense) existing.dense = entry.score;
      } else {
        fused.set(entry.chunk.id, {
          chunk: entry.chunk,
          score: contribution,
          dense: isDense ? entry.score : 0,
        });
      }
    });
  };
  fuse(dense, true);
  fuse(lexical, false);

  const hits: SearchHit[] = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topK)
    .map((entry) => ({ chunk: entry.chunk, score: entry.dense }));

  const sources: SourceRef[] = hits.map((hit, i) => ({
    index: i + 1,
    docId: hit.chunk.docId,
    docName: hit.chunk.docName,
    page: hit.chunk.page,
    section: hit.chunk.section,
    snippet: hit.chunk.text,
    score: Math.round(hit.score * 1000) / 1000,
  }));
  return { hits, sources };
}

export function buildMessages(history: ChatTurn[], question: string, hits: SearchHit[]): Anthropic.MessageParam[] {
  const sourcesBlock = hits
    .map((hit, i) => {
      const header = [hit.chunk.docName, `page ${hit.chunk.page}`, hit.chunk.section]
        .filter(Boolean)
        .join(' — ');
      return `[${i + 1}] ${header}\n${hit.chunk.text}`;
    })
    .join('\n\n');

  const finalUserContent = `SOURCES :\n${sourcesBlock}\n\nQUESTION : ${question}`;

  return [
    ...history.map((turn): Anthropic.MessageParam => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: finalUserContent },
  ];
}

export function streamAnswer(messages: Anthropic.MessageParam[]) {
  return client.messages.stream({
    model: config.model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  });
}
