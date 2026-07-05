import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';

/**
 * Build a unique temp-file path. Uses the OS temp dir by default (cross-platform
 * via `os.tmpdir()`) and a random name so concurrent operations never collide.
 * The file itself is created by the caller when it opens a write stream to it.
 */
export function createTempFilePath(dir: string = tmpdir()): string {
  return join(dir, `safe-stream-archiver-${randomBytes(12).toString('hex')}.tmp`);
}

/**
 * Remove a temp file, ignoring "already gone" and any other error. Cleanup must
 * never crash the archive — a leftover temp file is harmless; a thrown error
 * mid-stream is not.
 */
export async function removeTempFile(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {
    /* best-effort */
  });
}
