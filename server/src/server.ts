import 'dotenv/config';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { config } from './config.ts';
import { chatRoutes } from './routes/chat.ts';
import { documentRoutes } from './routes/documents.ts';
import { warmup } from './services/embeddings.ts';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

app.get('/api/health', async () => ({
  ok: true,
  model: config.model,
  vectorStore: config.qdrantUrl ? 'qdrant' : 'local',
}));

documentRoutes(app);
chatRoutes(app);

await app.listen({ port: config.port, host: '0.0.0.0' });

// Download/warm the embedding model in the background so the first upload is fast.
warmup()
  .then(() => app.log.info('embedding model ready'))
  .catch((err) => app.log.error(err, 'embedding warmup failed'));
