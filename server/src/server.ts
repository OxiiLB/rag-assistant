import 'dotenv/config';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { warmup } from './services/embeddings.ts';
import { enqueue, enqueueSuggestions } from './services/ingest.ts';
import { listDocuments } from './services/registry.ts';

const app = await buildApp();

// Uploads interrupted by a restart resume from their saved PDF (ingestion is idempotent).
for (const doc of listDocuments()) {
  if (doc.status === 'processing') enqueue(doc.id, app.log);
  else if (doc.status === 'ready' && !doc.suggestions) enqueueSuggestions(doc.id, app.log);
}

await app.listen({ port: config.port, host: '0.0.0.0' });

// Download/warm the embedding model in the background so the first upload is fast.
warmup()
  .then(() => app.log.info('embedding model ready'))
  .catch((err) => app.log.error(err, 'embedding warmup failed'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    // An unfinished ingest job is left in "processing" and resumes on next start.
    app.close().finally(() => process.exit(0));
  });
}
