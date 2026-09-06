import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { buildMessages, retrieve, streamAnswer } from '../services/rag.ts';
import { listDocuments } from '../services/registry.ts';
import type { ChatTurn } from '../types.ts';

interface ChatBody {
  /** Full conversation, last entry being the new user question (plain text, no sources). */
  messages: ChatTurn[];
}

/**
 * POST /api/chat — Server-Sent Events stream.
 * Events: `sources` (SourceRef[]), `delta` ({text}), `done` ({usage}), `error` ({message}).
 */
export function chatRoutes(app: FastifyInstance): void {
  app.post<{ Body: ChatBody }>('/api/chat', async (req, reply) => {
    const messages = req.body?.messages;
    const last = messages?.at(-1);
    if (!Array.isArray(messages) || last?.role !== 'user' || !last.content?.trim()) {
      return reply.code(400).send({ error: 'Corps attendu : { messages: [...] } terminé par un message utilisateur.' });
    }
    if (listDocuments().length === 0) {
      return reply.code(409).send({ error: 'Aucun document indexé. Ajoutez au moins un PDF avant de poser une question.' });
    }

    const question = last.content.trim();
    const history = messages.slice(0, -1);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { hits, sources } = await retrieve(question);
      send('sources', sources);

      const stream = streamAnswer(buildMessages(history, question, hits));
      req.raw.on('close', () => {
        if (req.raw.destroyed) stream.abort();
      });
      stream.on('text', (text) => send('delta', { text }));

      const final = await stream.finalMessage();
      send('done', {
        stopReason: final.stop_reason,
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          cacheReadTokens: final.usage.cache_read_input_tokens,
        },
      });
    } catch (err) {
      req.log.error(err, 'chat stream failed');
      send('error', { message: userFacingError(err) });
    } finally {
      raw.end();
    }
  });
}

function userFacingError(err: unknown): string {
  if (err instanceof Error && err.message.includes('authentication method')) {
    return 'Clé API Anthropic non configurée : copiez server/.env.example vers server/.env et renseignez ANTHROPIC_API_KEY.';
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Clé API Anthropic manquante ou invalide (variable ANTHROPIC_API_KEY dans server/.env).';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Limite de débit de l’API atteinte, réessayez dans un instant.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Erreur API LLM (${err.status}) : ${err.message}`;
  }
  if (err instanceof Error && err.name === 'AbortError') return 'Génération interrompue.';
  return err instanceof Error ? err.message : 'Erreur inattendue côté serveur.';
}
