import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { type ErrorBody, errorBody } from '../errors.ts';
import { buildMessages, retrieve, streamAnswer } from '../services/rag.ts';
import { listDocuments } from '../services/registry.ts';
import type { ChatTurn } from '../types.ts';

interface ChatBody {
  /** Full conversation, last entry being the new user question (plain text, no sources). */
  messages: ChatTurn[];
}

const chatSchema = {
  body: {
    type: 'object',
    required: ['messages'],
    properties: {
      messages: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        items: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { enum: ['user', 'assistant'] },
            // Past answers can be long; the new question gets its own, tighter cap below.
            content: { type: 'string', maxLength: 20000 },
          },
        },
      },
    },
  },
} as const;

/**
 * POST /api/chat — Server-Sent Events stream.
 * Events: `sources` (SourceRef[]), `delta` ({text}), `done` ({usage}), `error` ({message, code, params?}).
 */
export function chatRoutes(app: FastifyInstance): void {
  const options = {
    schema: chatSchema,
    config: { rateLimit: { max: config.rateLimit.chat, timeWindow: '1 minute' } },
  };

  app.post<{ Body: ChatBody }>('/api/chat', options, async (req, reply) => {
    const { messages } = req.body;
    const last = messages.at(-1);
    if (last?.role !== 'user' || !last.content.trim()) {
      return reply.code(400).send(errorBody('no_question', 'The conversation must end with a question.'));
    }
    if (last.content.length > config.maxQuestionChars) {
      return reply.code(400).send(
        errorBody('question_too_long', `Question too long (maximum ${config.maxQuestionChars} characters).`, {
          max: config.maxQuestionChars,
        }),
      );
    }
    if (!listDocuments().some((d) => d.status === 'ready')) {
      return reply.code(409).send(
        errorBody('no_documents', 'No documents indexed. Add at least one PDF before asking a question.'),
      );
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
      const retrievalStart = Date.now();
      const { hits, sources } = await retrieve(question);
      const retrievalMs = Date.now() - retrievalStart;
      send('sources', sources);

      const stream = streamAnswer(buildMessages(history, question, hits));
      req.raw.on('close', () => {
        if (req.raw.destroyed) stream.abort();
      });
      stream.on('text', (text) => send('delta', { text }));

      const final = await stream.finalMessage();
      const usage = {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens,
      };
      // Metrics only: question and document text stay out of the logs.
      req.log.info({ hits: hits.length, retrievalMs, stopReason: final.stop_reason, ...usage }, 'chat answered');
      send('done', { stopReason: final.stop_reason, usage });
    } catch (err) {
      req.log.error(err, 'chat stream failed');
      const { error, ...rest } = userFacingError(err);
      send('error', { message: error, ...rest });
    } finally {
      raw.end();
    }
  });
}

function userFacingError(err: unknown): ErrorBody {
  if (err instanceof Error && err.message.includes('authentication method')) {
    return errorBody(
      'api_key_missing',
      'Anthropic API key not configured: copy server/.env.example to server/.env and set ANTHROPIC_API_KEY.',
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return errorBody('api_key_invalid', 'Anthropic API key missing or invalid (ANTHROPIC_API_KEY in server/.env).');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return errorBody('llm_rate_limited', 'API rate limit reached, try again in a moment.');
  }
  if (err instanceof Anthropic.APIError) {
    return errorBody('llm_error', `LLM API error (${err.status}): ${err.message}`, { status: err.status ?? 0 });
  }
  if (err instanceof Error && err.name === 'AbortError') return errorBody('aborted', 'Generation stopped.');
  return errorBody('internal', err instanceof Error ? err.message : 'Unexpected server error.');
}
