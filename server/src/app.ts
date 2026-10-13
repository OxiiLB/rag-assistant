import fs from 'node:fs';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { config } from './config.ts';
import { type ErrorParams, errorBody } from './errors.ts';
import { chatRoutes } from './routes/chat.ts';
import { documentRoutes } from './routes/documents.ts';
import { embeddingReady } from './services/embeddings.ts';

/** Builds the HTTP app without listening, so tests can drive it with `app.inject`. */
export async function buildApp({ logger = true } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: config.trustProxy });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Angular injects component styles at runtime.
        'style-src': ["'self'", "'unsafe-inline'"],
        // Cited PDFs open in the browser's viewer, served from this origin.
        'object-src': ["'self'"],
        'frame-src': ["'self'"],
        // HTTPS is the host's job; this directive would break a production build tested on http://localhost.
        'upgrade-insecure-requests': null,
      },
    },
  });
  // In production the web app is same-origin; this list only matters for `ng serve` and local tools.
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(rateLimit, {
    max: config.rateLimit.global,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new Error(`Too many requests: try again in ${Math.ceil(ctx.ttl / 1000)} s.`), {
        statusCode: 429,
        errorCode: 'rate_limited',
        params: { seconds: Math.ceil(ctx.ttl / 1000) },
      }),
  });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  // One error shape for the client: { error, code, params? }, never internals on 5xx.
  app.setErrorHandler((err: FastifyError & { errorCode?: string; params?: ErrorParams }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (err.validation) {
      return reply.code(400).send(errorBody('invalid_request', `Invalid request: ${err.message}`));
    }
    if (status >= 500) {
      req.log.error(err);
      return reply.code(status).send(errorBody('internal', 'Internal server error.'));
    }
    return reply.code(status).send(errorBody(err.errorCode ?? 'request_failed', err.message, err.params));
  });

  app.get('/api/health', async () => ({
    ok: true,
    model: config.model,
    vectorStore: config.qdrantUrl ? 'qdrant' : 'local',
    embeddingReady: embeddingReady(),
    demoMode: config.demoMode,
  }));

  documentRoutes(app);
  chatRoutes(app);

  if (config.production) {
    if (!fs.existsSync(config.webDistDir)) {
      app.log.warn({ dir: config.webDistDir }, 'web build not found: only the API is served');
    }
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: unknown non-API GETs get index.html, the Angular app handles the route.
    if (config.production && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('route_not_found', 'Route not found.'));
  });

  return app;
}
