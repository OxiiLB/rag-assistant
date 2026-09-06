import type { Chunk } from '../types.ts';

/**
 * BM25 keyword index over the indexed chunks.
 *
 * Dense embeddings capture meaning but blur rare, discriminating terms: on a
 * homogeneous corpus `multilingual-e5-small` scores every passage between 0.81
 * and 0.88, so a query naming an exact section ("Must") does not reliably rank
 * that section first. BM25 nails those; the two are fused in `rag.ts`.
 */

const K1 = 1.5;
const B = 0.75;

// Frequent words carry no discriminating signal in either language.
const STOPWORDS = new Set([
  'a', 'ai', 'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du', 'elle', 'en', 'est', 'et',
  'eu', 'il', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma', 'mais', 'me', 'meme', 'mes', 'moi',
  'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour', 'que', 'qui', 'sa', 'se',
  'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous',
  'y', 'the', 'of', 'and', 'to', 'in', 'is', 'it', 'for', 'on', 'with', 'as', 'at', 'by',
  'quel', 'quels', 'quelle', 'quelles', 'sont', 'est-ce', 'dont', 'plus', 'tout', 'tous',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "réponse" matches "reponse"
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface Entry {
  chunk: Chunk;
  terms: Map<string, number>;
  length: number;
}

export class LexicalIndex {
  private entries: Entry[] = [];
  private docFreq = new Map<string, number>();
  private avgLength = 0;

  build(chunks: Chunk[]): void {
    this.entries = chunks.map((chunk) => {
      // The section heading is part of the searchable text: a chunk whose body
      // starts mid-section still matches a query naming that section.
      const tokens = tokenize(`${chunk.section ?? ''} ${chunk.text}`);
      const terms = new Map<string, number>();
      for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
      return { chunk, terms, length: tokens.length };
    });

    this.docFreq.clear();
    for (const entry of this.entries) {
      for (const term of entry.terms.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.avgLength = this.entries.length
      ? this.entries.reduce((sum, e) => sum + e.length, 0) / this.entries.length
      : 0;
  }

  search(query: string, limit: number): { chunk: Chunk; score: number }[] {
    if (this.entries.length === 0) return [];
    const queryTerms = tokenize(query);
    const total = this.entries.length;

    const scored = this.entries.map((entry) => {
      let score = 0;
      for (const term of queryTerms) {
        const tf = entry.terms.get(term);
        if (!tf) continue;
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        const norm = tf + K1 * (1 - B + (B * entry.length) / this.avgLength);
        score += idf * ((tf * (K1 + 1)) / norm);
      }
      return { chunk: entry.chunk, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
