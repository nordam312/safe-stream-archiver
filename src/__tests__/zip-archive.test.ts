import { Readable } from 'node:stream';

import { fromBuffer } from 'yauzl';
import { describe, it, expect } from 'vitest';

import { createZipArchive } from '../zip-archive.js';

import type { ArchiveEntry } from '../types.js';

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

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Read a ZIP buffer into { name -> content } using yauzl. */
function readZip(buffer: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('failed to open zip'));
        return;
      }
      const files: Record<string, Buffer> = {};
      zipfile.on('error', reject);
      zipfile.on('end', () => resolve(files));
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        zipfile.openReadStream(entry, (streamErr, rs) => {
          if (streamErr || !rs) {
            reject(streamErr ?? new Error('failed to read entry'));
            return;
          }
          const chunks: Buffer[] = [];
          rs.on('data', (c: Buffer) => chunks.push(c));
          rs.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks);
            zipfile.readEntry();
          });
        });
      });
    });
  });
}

describe('createZipArchive', () => {
  it('archives entries whose size is UNKNOWN (streamed via data descriptors)', async () => {
    const entries: ArchiveEntry[] = [
      { name: 'a.txt', stream: makeStream(3, 100) }, // 300 bytes, no size
      { name: 'b.txt', stream: makeStream(2, 50) }, // 100 bytes, no size
    ];

    const files = await readZip(await collect(createZipArchive(entries)));

    expect(Object.keys(files).sort()).toEqual(['a.txt', 'b.txt']);
    expect(files['a.txt']?.length).toBe(300);
    expect(files['b.txt']?.length).toBe(100);
  });

  it('streams a large unsized entry without buffering it whole, byte-perfect', async () => {
    // 256 KiB, no size given → yazl streams it; no spooling involved.
    const entries: ArchiveEntry[] = [{ name: 'big.bin', stream: makeStream(256, 1024, 0x7a) }];

    const files = await readZip(await collect(createZipArchive(entries)));

    expect(files['big.bin']?.length).toBe(256 * 1024);
    expect(files['big.bin']?.every((b) => b === 0x7a)).toBe(true);
  });

  it('propagates a source error to the archive consumer', async () => {
    const boom = new Readable({
      read() {
        this.destroy(new Error('source failed'));
      },
    });
    const entries: ArchiveEntry[] = [{ name: 'x.txt', stream: boom }];

    await expect(collect(createZipArchive(entries))).rejects.toThrow('source failed');
  });
});
