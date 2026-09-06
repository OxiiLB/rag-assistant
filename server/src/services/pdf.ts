import { extractText, getDocumentProxy } from 'unpdf';

export interface PdfPage {
  page: number;
  text: string;
}

export interface PdfContent {
  /** Pages carrying usable text; page numbers stay absolute so citations hold. */
  pages: PdfPage[];
  /** Total pages in the file, including the empty ones dropped from `pages`. */
  pageCount: number;
}

export async function extractPdfPages(buffer: Buffer): Promise<PdfContent> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  // mergePages: false → one entry per page, which is what makes citations useful.
  const { text } = await extractText(pdf, { mergePages: false });

  const pages = text
    .map((pageText, i) => ({ page: i + 1, text: normalize(pageText) }))
    .filter((p) => p.text.length > 50); // covers/blank pages carry no answers

  return { pages, pageCount: text.length };
}

function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/-\n(\p{Ll})/gu, '$1') // rejoin words hyphenated across a line break
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
