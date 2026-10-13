import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { config } from '../config.ts';
import { errorBody } from '../errors.ts';
import { enqueue } from '../services/ingest.ts';
import * as registry from '../services/registry.ts';
import { vectorStore } from '../services/vector-store.ts';
import type { DocumentMeta } from '../types.ts';

const idParams = {
  params: {
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' } },
    required: ['id'],
  },
} as const;

function refuseInDemo(reply: FastifyReply) {
  return reply.code(403).send(errorBody('demo_read_only', 'Demo mode: the corpus is read-only.'));
}

export function documentRoutes(app: FastifyInstance): void {
  app.get('/api/documents', async () => registry.listDocuments());

  app.post(
    '/api/documents',
    { config: { rateLimit: { max: config.rateLimit.upload, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (config.demoMode) return refuseInDemo(reply);

      const file = await req.file();
      if (!file) {
        return reply.code(400).send(errorBody('no_file', 'No file received.'));
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch (err) {
        if (err instanceof app.multipartErrors.RequestFileTooLargeError) {
          const maxMb = config.maxUploadBytes / 1024 / 1024;
          return reply.code(413).send(errorBody('file_too_large', `File too large (maximum ${maxMb} MB).`, { maxMb }));
        }
        throw err;
      }

      // The header may follow a little leading garbage, which readers tolerate within 1 KB.
      if (!buffer.subarray(0, 1024).includes('%PDF-')) {
        return reply.code(415).send(errorBody('not_pdf', 'This file is not a valid PDF.'));
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const existing = registry.findByHash(hash);
      if (existing && existing.status !== 'failed') {
        return reply.code(409).send(
          errorBody('already_indexed', `This document is already indexed ("${existing.name}").`, {
            name: existing.name,
          }),
        );
      }

      const meta: DocumentMeta = {
        id: crypto.randomUUID(),
        name: file.filename,
        sizeBytes: buffer.length,
        pages: 0,
        chunkCount: 0,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
        progress: 0,
        hash,
      };
      // Persist before indexing: a restart can then resume the job from the saved PDF.
      registry.addDocument(meta, buffer);
      enqueue(meta.id, req.log);
      return reply.code(202).send(meta);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/documents/:id', { schema: idParams }, async (req, reply) => {
    if (config.demoMode) return refuseInDemo(reply);
    const doc = registry.getDocument(req.params.id);
    if (!doc) return reply.code(404).send(errorBody('not_found', 'Document not found.'));
    await vectorStore.deleteByDoc(doc.id);
    registry.removeDocument(doc.id);
    return { ok: true };
  });

  /** Serves the original PDF so citations can deep-link to a page (#page=N). */
  app.get<{ Params: { id: string } }>('/api/documents/:id/file', { schema: idParams }, async (req, reply) => {
    const doc = registry.getDocument(req.params.id);
    const path = registry.pdfPath(req.params.id);
    if (!doc || !fs.existsSync(path)) {
      return reply.code(404).send(errorBody('not_found', 'Document not found.'));
    }
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${encodeURIComponent(doc.name)}"`)
      .send(fs.createReadStream(path));
  });
}
