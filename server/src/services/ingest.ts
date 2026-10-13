import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.ts';
import { type ErrorBody, type ErrorParams, errorBody } from '../errors.ts';
import type { Chunk } from '../types.ts';
import { chunkPages, contextualText } from './chunking.ts';
import { embedPassages } from './embeddings.ts';
import { extractPdfPages } from './pdf.ts';
import * as registry from './registry.ts';
import { generateSuggestions } from './suggestions.ts';
import { vectorStore } from './vector-store.ts';

/**
 * Background indexing of uploaded PDFs. Jobs run one at a time on purpose:
 * embedding is CPU-bound, so parallel jobs would only slow each other down.
 */

class IngestError extends Error {
  readonly code: string;
  readonly params: ErrorParams | undefined;

  constructor(message: string, code: string, params?: ErrorParams) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

let queue: Promise<void> = Promise.resolve();

export function enqueue(docId: string, log: FastifyBaseLogger): void {
  // The catch keeps one broken job (e.g. disk full) from stalling every later one.
  queue = queue.then(() => ingest(docId, log)).catch((err) => log.error({ err, docId }, 'ingest job crashed'));
}

/** For documents indexed before suggestions existed: generates them from the stored chunks. */
export function enqueueSuggestions(docId: string, log: FastifyBaseLogger): void {
  queue = queue
    .then(async () => {
      const chunks = (await vectorStore.listChunks()).filter((c) => c.docId === docId);
      if (chunks.length > 0) await suggest(docId, chunks, log);
    })
    .catch((err) => log.error({ err, docId }, 'suggestion job crashed'));
}

/** Stores starter questions for the chat's empty state; failure only means none are shown. */
async function suggest(docId: string, chunks: Chunk[], log: FastifyBaseLogger): Promise<void> {
  const doc = registry.getDocument(docId);
  if (!doc) return;
  try {
    const suggestions = await generateSuggestions(doc.name, chunks);
    registry.updateDocument(docId, { suggestions });
  } catch (err) {
    log.warn({ err, docId }, 'suggestion generation failed');
  }
}

async function ingest(docId: string, log: FastifyBaseLogger): Promise<void> {
  const doc = registry.getDocument(docId);
  if (!doc) return;
  const started = Date.now();
  try {
    const { pages, pageCount } = await extractPdfPages(fs.readFileSync(registry.pdfPath(docId)));
    if (pageCount > config.maxPages) {
      throw new IngestError(`Document too long: ${pageCount} pages (maximum ${config.maxPages}).`, 'too_many_pages', {
        pages: pageCount,
        max: config.maxPages,
      });
    }
    if (pages.reduce((n, p) => n + p.text.length, 0) < 20) {
      throw new IngestError('No usable text in this PDF (scanned document? OCR would be required).', 'no_text');
    }

    const chunks = chunkPages(pages, docId, doc.name);
    const vectors = await embedPassages(chunks.map(contextualText), (done) =>
      registry.updateDocument(docId, { progress: done / chunks.length }),
    );

    // A job resumed after a crash may already have written some of its chunks.
    await vectorStore.deleteByDoc(docId);
    await vectorStore.upsert(chunks, vectors);
    // Before flipping to ready: the client stops polling once nothing is processing.
    await suggest(docId, chunks, log);

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
    const { error, code, params } = failure(err);
    registry.updateDocument(docId, { status: 'failed', error, errorCode: code, errorParams: params, progress: undefined });
  }
}

function failure(err: unknown): ErrorBody {
  if (err instanceof IngestError) return errorBody(err.code, err.message, err.params);
  const name = err instanceof Error ? err.name : '';
  if (name === 'PasswordException') {
    return errorBody('pdf_password', 'Password-protected PDF: remove the protection and try again.');
  }
  if (name === 'InvalidPDFException') return errorBody('pdf_corrupt', 'Corrupt or unreadable PDF.');
  return errorBody('indexing_failed', 'Indexing failed (internal error).');
}
