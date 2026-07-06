import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { extract } from 'tar-stream';
import { describe, it, expect } from 'vitest';

import { createTarArchive } from '../tar-archive.js';

import type { ArchiveEntry } from '../types.js';

/** A readable emitting `chunkCount` chunks of `chunkSize` bytes. */
function makeStream(chunkCount: number, chunkSize: number, fill = 0x61): Readable {
  let emitted = 0;
  return new Readable({
    read() {
      if (emitted >= chunkCount) {
        this.push(null);
        return;
      }
      emitted += 1;
      this.push(Buffer.alloc(chunkSize, fill));
    },
  });
}

/** Extract a TAR stream into { name -> content }. */
async function readTar(archive: Readable): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  const ex = extract();

  ex.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => {
      files[header.name] = Buffer.concat(chunks);
      next();
    });
    stream.resume();
  });

  await pipeline(archive, ex);
  return files;
}

describe('createTarArchive', () => {
  it('archives entries whose size is UNKNOWN (the case raw tar-stream cannot do)', async () => {
    const entries: ArchiveEntry[] = [
      { name: 'a.txt', stream: makeStream(3, 100) }, // 300 bytes, no size given
      { name: 'b.txt', stream: makeStream(2, 50) }, // 100 bytes, no size given
    ];

    const files = await readTar(createTarArchive(entries));

    expect(Object.keys(files).sort()).toEqual(['a.txt', 'b.txt']);
    expect(files['a.txt']?.length).toBe(300);
    expect(files['b.txt']?.length).toBe(100);
  });

  it('spools a large unsized entry to disk and still archives it correctly', async () => {
    // 64 KiB content, threshold 4 KiB → forces the disk-spool path.
    const entries: ArchiveEntry[] = [{ name: 'big.bin', stream: makeStream(64, 1024, 0x7a) }];

    const files = await readTar(createTarArchive(entries, { memoryThresholdBytes: 4 * 1024 }));

    expect(files['big.bin']?.length).toBe(64 * 1024);
    expect(files['big.bin']?.every((b) => b === 0x7a)).toBe(true);
  });

  it('uses a provided (trusted) size without buffering', async () => {
    const entries: ArchiveEntry[] = [
      { name: 'known.txt', stream: makeStream(4, 25), size: 100 },
    ];

    const files = await readTar(createTarArchive(entries));
    expect(files['known.txt']?.length).toBe(100);
  });

  it('propagates a source error to the archive consumer', async () => {
    const boom = new Readable({
      read() {
        this.destroy(new Error('source failed'));
      },
    });
    const entries: ArchiveEntry[] = [{ name: 'x.txt', stream: boom }];

    await expect(readTar(createTarArchive(entries))).rejects.toThrow('source failed');
  });
});
