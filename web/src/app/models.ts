export interface DocumentMeta {
  id: string;
  name: string;
  sizeBytes: number;
  pages: number;
  chunkCount: number;
  uploadedAt: string;
  status: 'processing' | 'ready' | 'failed';
  /** 0–1 while processing. */
  progress?: number;
  error?: string;
  /** Translatable key for `error` (see I18n.error). */
  errorCode?: string;
  errorParams?: Record<string, string | number>;
}

export interface Health {
  model: string;
  embeddingReady: boolean;
  demoMode: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SourceRef {
  index: number;
  docId: string;
  docName: string;
  page: number;
  /** Heading path the passage came from, e.g. "FICHE PROJET 1 › MUST". */
  section?: string;
  snippet: string;
  score: number;
}

export interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  error?: string;
  streaming?: boolean;
}

/** A rendered piece of an assistant answer: plain text, bold run, or a clickable citation. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'cite'; index: number };

/** A line-level piece of an assistant answer, each holding inline segments. */
export interface Block {
  kind: 'paragraph' | 'heading' | 'list';
  /** One entry per list item; paragraphs and headings have exactly one. */
  items: Segment[][];
  ordered?: boolean;
  /** First number of an ordered list, which may resume after a paragraph. */
  start?: number;
  /** Nested list under each item (lists only, one level deep). */
  children?: (Block | undefined)[];
}

export type ChatEvent =
  | { type: 'sources'; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string; params?: Record<string, string | number> };
