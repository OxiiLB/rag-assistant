export interface DocumentMeta {
  id: string;
  name: string;
  sizeBytes: number;
  pages: number;
  chunkCount: number;
  uploadedAt: string;
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
