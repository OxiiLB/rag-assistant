import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import type { DocumentMeta } from '../types.ts';

/** Document metadata registry (JSON file) + storage of the original PDFs. */

const registryFile = () => path.join(config.dataDir, 'documents.json');
const uploadsDir = () => path.join(config.dataDir, 'uploads');

function load(): DocumentMeta[] {
  const file = registryFile();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function save(docs: DocumentMeta[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(docs, null, 2));
}

export function listDocuments(): DocumentMeta[] {
  return load().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function getDocument(id: string): DocumentMeta | undefined {
  return load().find((d) => d.id === id);
}

export function addDocument(meta: DocumentMeta, pdf: Buffer): void {
  fs.mkdirSync(uploadsDir(), { recursive: true });
  fs.writeFileSync(pdfPath(meta.id), pdf);
  save([...load(), meta]);
}

export function removeDocument(id: string): void {
  save(load().filter((d) => d.id !== id));
  fs.rmSync(pdfPath(id), { force: true });
}

export function pdfPath(id: string): string {
  return path.join(uploadsDir(), `${id}.pdf`);
}
