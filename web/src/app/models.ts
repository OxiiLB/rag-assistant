export interface DocumentMeta {
  id: string;
  name: string;
  sizeBytes: number;
  pages: number;
  chunkCount: number;
  uploadedAt: string;
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

export type ChatEvent =
  | { type: 'sources'; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
