import path from 'node:path';

const list = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  production: process.env.NODE_ENV === 'production',
  model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
  /** Small, fast model that turns follow-up questions into standalone search queries. */
  rewriteModel: process.env.ANTHROPIC_REWRITE_MODEL ?? 'claude-haiku-5-5',
  /** Optional: when set (e.g. http://localhost:6333), vectors go to Qdrant instead of the local file store. */
  qdrantUrl: process.env.QDRANT_URL,
  qdrantCollection: process.env.QDRANT_COLLECTION ?? 'rag_chunks',
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  /** Angular build served by Fastify in production (single origin, no CORS). */
  webDistDir: path.resolve(process.env.WEB_DIST_DIR ?? '../web/dist/web/browser'),
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'Xenova/multilingual-e5-small',
  /** multilingual-e5-small output dimension */
  embeddingDim: 384,
  topK: Number(process.env.RAG_TOP_K ?? 8),

  /** Public showcase: corpus is preloaded, visitors can chat but not upload or delete. */
  demoMode: process.env.DEMO_MODE === 'true',
  maxUploadBytes: 25 * 1024 * 1024,
  maxPages: Number(process.env.MAX_PAGES ?? 500),
  maxQuestionChars: 2000,
  /** Past turns sent to the LLM; older ones are dropped to bound cost per question. */
  maxHistoryTurns: 10,

  corsOrigins: list(process.env.CORS_ORIGINS, 'http://localhost:4200'),
  /** Behind a PaaS proxy, rate limits must key on X-Forwarded-For, not the proxy's IP. */
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Requests per minute per IP. */
  rateLimit: {
    global: Number(process.env.RATE_LIMIT_GLOBAL ?? 100),
    chat: Number(process.env.RATE_LIMIT_CHAT ?? 10),
    upload: Number(process.env.RATE_LIMIT_UPLOAD ?? 5),
  },
};