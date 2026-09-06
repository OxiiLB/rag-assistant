import fs from 'node:fs';
import path from 'node:path';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.ts';
import type { Chunk, SearchHit } from '../types.ts';

export interface VectorStore {
  upsert(chunks: Chunk[], vectors: number[][]): Promise<void>;
  search(vector: number[], topK: number): Promise<SearchHit[]>;
  deleteByDoc(docId: string): Promise<void>;
  /** Every indexed chunk — the keyword index in `lexical.ts` is built from this. */
  listChunks(): Promise<Chunk[]>;
  /** Bumped on every write so dependent indexes know to rebuild. */
  readonly revision: number;
}

/**
 * File-backed store with in-memory cosine search. Vectors are normalized, so
 * the dot product is the cosine similarity. Plenty for a few demo documents;
 * set QDRANT_URL to switch to Qdrant without touching the rest of the app.
 */
class LocalVectorStore implements VectorStore {
  private points: { vector: number[]; chunk: Chunk }[] = [];
  private readonly file = path.join(config.dataDir, 'vectors.json');
  revision = 0;

  constructor() {
    if (fs.existsSync(this.file)) {
      this.points = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    }
  }

  async upsert(chunks: Chunk[], vectors: number[][]): Promise<void> {
    chunks.forEach((chunk, i) => this.points.push({ vector: vectors[i]!, chunk }));
    this.save();
  }

  async search(vector: number[], topK: number): Promise<SearchHit[]> {
    return this.points
      .map(({ vector: v, chunk }) => ({ chunk, score: dot(vector, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async deleteByDoc(docId: string): Promise<void> {
    this.points = this.points.filter((p) => p.chunk.docId !== docId);
    this.save();
  }

  async listChunks(): Promise<Chunk[]> {
    return this.points.map((p) => p.chunk);
  }

  private save(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.points));
    this.revision++;
  }
}

class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private ready: Promise<void> | undefined;
  revision = 0;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  private ensureCollection(): Promise<void> {
    this.ready ??= (async () => {
      const { exists } = await this.client.collectionExists(config.qdrantCollection);
      if (!exists) {
        await this.client.createCollection(config.qdrantCollection, {
          vectors: { size: config.embeddingDim, distance: 'Cosine' },
        });
      }
    })();
    return this.ready;
  }

  async upsert(chunks: Chunk[], vectors: number[][]): Promise<void> {
    await this.ensureCollection();
    await this.client.upsert(config.qdrantCollection, {
      wait: true,
      points: chunks.map((chunk, i) => ({
        id: chunk.id,
        vector: vectors[i]!,
        payload: { ...chunk },
      })),
    });
    this.revision++;
  }

  async search(vector: number[], topK: number): Promise<SearchHit[]> {
    await this.ensureCollection();
    const { points } = await this.client.query(config.qdrantCollection, {
      query: vector,
      limit: topK,
      with_payload: true,
    });
    return points.map((p) => ({ chunk: p.payload as unknown as Chunk, score: p.score }));
  }

  async deleteByDoc(docId: string): Promise<void> {
    await this.ensureCollection();
    await this.client.delete(config.qdrantCollection, {
      wait: true,
      filter: { must: [{ key: 'docId', match: { value: docId } }] },
    });
    this.revision++;
  }

  async listChunks(): Promise<Chunk[]> {
    await this.ensureCollection();
    const chunks: Chunk[] = [];
    let offset: string | number | undefined | null;
    do {
      const page = await this.client.scroll(config.qdrantCollection, {
        limit: 256,
        with_payload: true,
        with_vector: false,
        ...(offset == null ? {} : { offset }),
      });
      chunks.push(...page.points.map((p) => p.payload as unknown as Chunk));
      offset = page.next_page_offset as typeof offset;
    } while (offset != null);
    return chunks;
  }
}

export const vectorStore: VectorStore = config.qdrantUrl
  ? new QdrantVectorStore(config.qdrantUrl)
  : new LocalVectorStore();

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
