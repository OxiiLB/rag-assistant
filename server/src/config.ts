import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
  /** Optional: when set (e.g. http://localhost:6333), vectors go to Qdrant instead of the local file store. */
  qdrantUrl: process.env.QDRANT_URL,
  qdrantCollection: process.env.QDRANT_COLLECTION ?? 'rag_chunks',
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'Xenova/multilingual-e5-small',
  /** multilingual-e5-small output dimension */
  embeddingDim: 384,
  topK: Number(process.env.RAG_TOP_K ?? 8),
  maxUploadBytes: 25 * 1024 * 1024,
};
