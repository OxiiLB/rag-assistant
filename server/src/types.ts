/** Languages the web UI is available in. */
export type Lang = 'en' | 'fr';

export type Suggestions = Record<Lang, string[]>;

export type DocumentStatus = 'processing' | 'ready' | 'failed';

export interface DocumentMeta {
  id: string;
  name: string;
  sizeBytes: number;
  /** 0 until indexing completes. */
  pages: number;
  chunkCount: number;
  uploadedAt: string;
  status: DocumentStatus;
  /** Share of chunks embedded so far (0–1), while processing. */
  progress?: number | undefined;
  /** User-facing reason, when failed. */
  error?: string | undefined;
  /** Stable key for `error`, translated by the web app. */
  errorCode?: string | undefined;
  errorParams?: Record<string, string | number> | undefined;
  /** Document-specific starter questions shown in the chat's empty state, per UI language. */
  suggestions?: Suggestions | undefined;
  /** SHA-256 of the PDF, to refuse indexing the same file twice. */
  hash: string;
}

export interface Chunk {
  id: string;
  docId: string;
  docName: string;
  page: number;
  text: string;
  /** Nearest preceding heading, carried so the passage keeps its section context. */
  section?: string | undefined;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Sent to the client alongside the streamed answer; `index` matches the [n] citations. */
export interface SourceRef {
  index: number;
  docId: string;
  docName: string;
  page: number;
  section?: string | undefined;
  snippet: string;
  score: number;
}
