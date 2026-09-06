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

export function embedPassages(texts: string[]): Promise<number[][]> {
  return embed(texts.map((t) => `passage: ${t}`));
}

/** Call at startup so the first upload doesn't pay the model download/warmup. */
export async function warmup(): Promise<void> {
  await embed(['warmup']);
}
