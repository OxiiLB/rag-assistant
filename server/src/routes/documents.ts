import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { chunkPages, contextualText } from '../services/chunking.ts';
import { embedPassages } from '../services/embeddings.ts';
import { extractPdfPages } from '../services/pdf.ts';
import * as registry from '../services/registry.ts';
import { vectorStore } from '../services/vector-store.ts';
import type { DocumentMeta } from '../types.ts';

export function documentRoutes(app: FastifyInstance): void {
  app.get('/api/documents', async () => registry.listDocuments());

  app.post('/api/documents', async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: 'Aucun fichier reçu.' });
    }
    if (file.mimetype !== 'application/pdf' && !file.filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(415).send({ error: 'Seuls les fichiers PDF sont acceptés.' });
    }

    const buffer = await file.toBuffer();
    const { pages, pageCount } = await extractPdfPages(buffer);
    const totalText = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalText < 20) {
      return reply.code(422).send({
        error: 'Aucun texte exploitable dans ce PDF (document scanné ? Un OCR serait nécessaire).',
      });
    }

    const docId = crypto.randomUUID();
    const chunks = chunkPages(pages, docId, file.filename);
    const vectors = await embedPassages(chunks.map(contextualText));
    await vectorStore.upsert(chunks, vectors);

    const meta: DocumentMeta = {
      id: docId,
      name: file.filename,
      sizeBytes: buffer.length,
      pages: pageCount,
      chunkCount: chunks.length,
      uploadedAt: new Date().toISOString(),
    };
    registry.addDocument(meta, buffer);
    return reply.code(201).send(meta);
  });

  app.delete<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    const doc = registry.getDocument(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'Document introuvable.' });
    await vectorStore.deleteByDoc(doc.id);
    registry.removeDocument(doc.id);
    return { ok: true };
  });

  /** Serves the original PDF so citations can deep-link to a page (#page=N). */
  app.get<{ Params: { id: string } }>('/api/documents/:id/file', async (req, reply) => {
    const doc = registry.getDocument(req.params.id);
    const path = registry.pdfPath(req.params.id);
    if (!doc || !fs.existsSync(path)) {
      return reply.code(404).send({ error: 'Document introuvable.' });
    }
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${encodeURIComponent(doc.name)}"`)
      .send(fs.createReadStream(path));
  });
}
