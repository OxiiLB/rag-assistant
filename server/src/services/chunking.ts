import crypto from 'node:crypto';
import type { Chunk } from '../types.ts';
import type { PdfPage } from './pdf.ts';

const TARGET_SIZE = 1000;
const OVERLAP = 150;

/** A line opening with one or more ALL-CAPS words: "MUST — ...", "PRÉLIMINAIRES ...". */
const HEADING = /^[A-ZÀ-Þ][A-ZÀ-Þ0-9'’·-]{2,}(?:\s+[A-ZÀ-Þ][A-ZÀ-Þ0-9'’·-]{2,}){0,3}\b/;

/**
 * Splits page text into ~1000-char chunks, preferring paragraph then sentence
 * boundaries, with a small overlap so answers spanning a cut are still found.
 * Chunks never cross pages, which keeps citations page-accurate.
 */
export function chunkPages(pages: PdfPage[], docId: string, docName: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    const headings = findHeadings(text);
    const title = pageTitle(text, headings);
    for (const piece of splitText(text)) {
      chunks.push({
        id: crypto.randomUUID(),
        docId,
        docName,
        page,
        text: piece.text,
        section: sectionPath(headings, title, piece.start),
      });
    }
  }
  return chunks;
}

/**
 * Text actually sent to the embedder. Document, page and section travel with the
 * passage: a chunk that starts mid-section would otherwise lose the heading that
 * makes it findable ("MUST — Fondations obligatoires"). `chunk.text` stays clean
 * for display and for the LLM prompt.
 */
export function contextualText(chunk: Chunk): string {
  const header = [chunk.docName, `page ${chunk.page}`, chunk.section].filter(Boolean).join(' — ');
  return `${header}\n\n${chunk.text}`;
}

interface Piece {
  text: string;
  start: number;
}

function splitText(text: string): Piece[] {
  if (text.length <= TARGET_SIZE) {
    return text.trim() ? [{ text: text.trim(), start: 0 }] : [];
  }

  const pieces: Piece[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + TARGET_SIZE, text.length);
    if (end < text.length) {
      end = findBreak(text, start, end);
    }
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push({ text: piece, start });
    if (end >= text.length) break;
    start = snapToWordStart(text, Math.max(end - OVERLAP, start + 1), end);
  }
  return pieces;
}

/** Looks backwards from `end` for a paragraph, then sentence, then word boundary. */
function findBreak(text: string, start: number, end: number): number {
  const window = text.slice(start, end);
  const minBreak = Math.floor(window.length * 0.5);
  for (const re of [/\n\s*\n/g, /[.!?]\s/g, /\s/g]) {
    let best = -1;
    for (const m of window.matchAll(re)) {
      if (m.index > minBreak) best = Math.max(best, m.index + m[0].length);
    }
    if (best !== -1) return start + best;
  }
  return end;
}

/**
 * Moves an overlap offset forward to the next word boundary. Without this a chunk
 * can start mid-word ("...Fondatio|ns obligatoires"). Never returns past `limit`,
 * so the split loop always makes progress.
 */
function snapToWordStart(text: string, offset: number, limit: number): number {
  if (offset === 0 || /\s/.test(text[offset - 1]!)) return offset;
  const space = text.slice(offset, limit).search(/\s/);
  return space === -1 ? offset : offset + space + 1;
}

interface Heading {
  offset: number;
  title: string;
}

function findHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const match = line.trim().match(HEADING);
    if (match) headings.push({ offset, title: line.trim().slice(0, 80) });
    offset += line.length + 1;
  }
  return headings;
}

/**
 * The page's own subject: its first heading plus the descriptive line under it
 * ("FICHE PROJET 1 / 3" + "Assistant RAG multi-documents avec citations").
 */
function pageTitle(text: string, headings: Heading[]): string | undefined {
  const first = headings[0];
  if (!first) return undefined;
  const after = text
    .slice(first.offset + first.title.length)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !HEADING.test(l));
  return after ? `${first.title} — ${after.slice(0, 80)}` : first.title;
}

/**
 * Ancestry of the passage: page subject, then the nearest heading above it. A
 * chunk cut out of the middle of a section otherwise loses both — and a question
 * that crosses the two ("the Must features of the RAG project") matches nothing.
 */
function sectionPath(headings: Heading[], title: string | undefined, start: number): string | undefined {
  let nearest: string | undefined;
  for (const heading of headings) {
    if (heading.offset > start) break;
    nearest = heading.title;
  }
  if (!title) return nearest;
  if (!nearest || title.startsWith(nearest)) return title;
  return `${title} › ${nearest}`;
}
