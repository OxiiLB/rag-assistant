import { pipeline } from '@huggingface/transformers';
import { config } from '../config.ts';

type Extractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

let extractorPromise: Promise<Extractor> | undefined;

/** Lazily loads the embedding model (downloaded to ./node_modules/.cache on first run). */
function getExtractor(): Promise<Extractor> {
  extractorPromise ??= pipeline('feature-extraction', config.embeddingModel, {
    dtype: 'q8',
  });
  return extractorPromise;
}

async function embed(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

// E5 models expect these prefixes; skipping them noticeably degrades retrieval.
export function embedQuery(text: string): Promise<number[]> {
  return embed([`query: ${text}`]).then((v) => v[0]!);
}

/** Batches bound memory on large PDFs and give the caller progress to report. */
const BATCH_SIZE = 32;

export async function embedPassages(texts: string[], onProgress?: (done: number) => void): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => `passage: ${t}`);
    vectors.push(...(await embed(batch)));
    onProgress?.(vectors.length);
  }
  return vectors;
}

let ready = false;

export function embeddingReady(): boolean {
  return ready;
}

/** Call at startup so the first upload doesn't pay the model download/warmup. */
export async function warmup(): Promise<void> {
  await embed(['warmup']);
  ready = true;
}
