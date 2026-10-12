import crypto from 'node:crypto';
import * as registry from '../src/services/registry.ts';
import type { Chunk, DocumentMeta, SearchHit } from '../src/types.ts';

/** Smallest valid one-page PDF showing `lines` in Helvetica. */
export function makePdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const ops = `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function multipartFile(filename: string, content: Buffer, contentType = 'application/pdf') {
  const boundary = `----test${crypto.randomUUID()}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Registers a document directly, bypassing upload and indexing (no embedding model needed). */
export function seedDocument(name: string, pdf: Buffer, status: DocumentMeta['status'] = 'ready'): DocumentMeta {
  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name,
    sizeBytes: pdf.length,
    pages: 1,
    chunkCount: 1,
    uploadedAt: new Date().toISOString(),
    status,
    hash: crypto.createHash('sha256').update(pdf).digest('hex'),
  };
  registry.addDocument(meta, pdf);
  return meta;
}

export function hit(text: string, overrides: Partial<Chunk> = {}): SearchHit {
  return {
    score: 0.9,
    chunk: { id: crypto.randomUUID(), docId: 'doc', docName: 'report.pdf', page: 1, text, ...overrides },
  };
}
