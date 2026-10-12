import fs from 'node:fs';
import path from 'node:path';

/** Write-then-rename: a crash mid-write leaves the previous file intact instead of truncated JSON. */
export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
