import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.ts';
import { chunkPages, contextualText } from './chunking.ts';
import { embedPassages } from './embeddings.ts';
import { extractPdfPages } from './pdf.ts';
import * as registry from './registry.ts';
import { vectorStore } from './vector-store.ts';

/**
 * Background indexing of uploaded PDFs. Jobs run one at a time on purpose:
 * embedding is CPU-bound, so parallel jobs would only slow each other down.
 */

class IngestError extends Error {}

let queue: Promise<void> = Promise.resolve();

export function enqueue(docId: string, log: FastifyBaseLogger): void {
  // The catch keeps one broken job (e.g. disk full) from stalling every later one.
  queue = queue.then(() => ingest(docId, log)).catch((err) => log.error({ err, docId }, 'ingest job crashed'));
}

async function ingest(docId: string, log: FastifyBaseLogger): Promise<void> {
  const doc = registry.getDocument(docId);
  if (!doc) return;
  const started = Date.now();
  try {
    const { pages, pageCount } = await extractPdfPages(fs.readFileSync(registry.pdfPath(docId)));
    if (pageCount > config.maxPages) {
      throw new IngestError(`Document too long: ${pageCount} pages (maximum ${config.maxPages}).`);
    }
    if (pages.reduce((n, p) => n + p.text.length, 0) < 20) {
      throw new IngestError('No usable text in this PDF (scanned document? OCR would be required).');
    }

    const chunks = chunkPages(pages, docId, doc.name);
    const vectors = await embedPassages(chunks.map(contextualText), (done) =>
      registry.updateDocument(docId, { progress: done / chunks.length }),
    );

    // A job resumed after a crash may already have written some of its chunks.
    await vectorStore.deleteByDoc(docId);
    await vectorStore.upsert(chunks, vectors);

    const updated = registry.updateDocument(docId, {
      status: 'ready',
      pages: pageCount,
      chunkCount: chunks.length,
      progress: undefined,
    });
    if (!updated) {
      // Deleted while we were indexing: drop what we just wrote.
      await vectorStore.deleteByDoc(docId);
      return;
    }
    log.info({ docId, pages: pageCount, chunks: chunks.length, ms: Date.now() - started }, 'document indexed');
  } catch (err) {
    log.error({ err, docId }, 'document indexing failed');
    registry.updateDocument(docId, { status: 'failed', error: failureMessage(err), progress: undefined });
  }
}

function failureMessage(err: unknown): string {
  if (err instanceof IngestError) return err.message;
  const name = err instanceof Error ? err.name : '';
  if (name === 'PasswordException') return 'Password-protected PDF: remove the protection and try again.';
  if (name === 'InvalidPDFException') return 'Corrupt or unreadable PDF.';
  return 'Indexing failed (internal error).';
}
