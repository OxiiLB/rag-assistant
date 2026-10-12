import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Import this first in every test file: config and the vector store read DATA_DIR at import time.
export const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-test-'));
process.env.DATA_DIR = dataDir;

process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
