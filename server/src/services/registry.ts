import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import type { DocumentMeta } from '../types.ts';
import { writeFileAtomic } from './atomic-write.ts';

/**
 * Document metadata registry (JSON file) + storage of the original PDFs.
 * Every read-modify-write below is synchronous, so the API handlers and the
 * ingest worker cannot interleave inside one — no lock needed.
 */

const registryFile = () => path.join(config.dataDir, 'documents.json');
const uploadsDir = () => path.join(config.dataDir, 'uploads');

function load(): DocumentMeta[] {
  const file = registryFile();
  if (!fs.existsSync(file)) return [];
  const docs: DocumentMeta[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Entries indexed before ingestion became asynchronous carry no status.
  return docs.map((d) => ({ ...d, status: d.status ?? 'ready', hash: d.hash ?? '' }));
}

function save(docs: DocumentMeta[]): void {
  writeFileAtomic(registryFile(), JSON.stringify(docs, null, 2));
}

export function listDocuments(): DocumentMeta[] {
  return load().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function getDocument(id: string): DocumentMeta | undefined {
  return load().find((d) => d.id === id);
}

export function findByHash(hash: string): DocumentMeta | undefined {
  return load().find((d) => d.hash === hash);
}

export function addDocument(meta: DocumentMeta, pdf: Buffer): void {
  fs.mkdirSync(uploadsDir(), { recursive: true });
  fs.writeFileSync(pdfPath(meta.id), pdf);
  save([...load(), meta]);
}

/** Returns the updated entry, or undefined if the document was deleted meanwhile. */
export function updateDocument(id: string, patch: Partial<DocumentMeta>): DocumentMeta | undefined {
  const docs = load();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return undefined;
  Object.assign(doc, patch);
  save(docs);
  return doc;
}

export function removeDocument(id: string): void {
  save(load().filter((d) => d.id !== id));
  fs.rmSync(pdfPath(id), { force: true });
}

export function pdfPath(id: string): string {
  return path.join(uploadsDir(), `${id}.pdf`);
}
