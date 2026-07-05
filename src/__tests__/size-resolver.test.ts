import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveContent } from '../size-resolver.js';

// A dedicated temp dir per test → temp-file counts are deterministic and never
// polluted by another test's async cleanup.
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ssa-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tempFileCount = async () => (await readdir(dir)).length;

/** A readable that emits `chunkCount` chunks of `chunkSize` bytes each. */
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

describe('resolveContent', () => {
  it('returns the exact size and replays the bytes (small → memory)', async () => {
    const { size, stream } = await resolveContent(makeStream(4, 100), {
      memoryThresholdBytes: 1024,
      tmpDir: dir,
    });

    expect(size).toBe(400);
    expect((await collect(stream)).length).toBe(400);
    // Small content stays in memory — no temp file created.
    expect(await tempFileCount()).toBe(0);
  });

  it('spools to disk when content exceeds the threshold, with the exact size', async () => {
    // 10 x 1 KiB = ~10 KiB, threshold 4 KiB → must spill to disk.
    const { size, stream } = await resolveContent(makeStream(10, 1024), {
      memoryThresholdBytes: 4 * 1024,
      tmpDir: dir,
    });

    expect(size).toBe(10 * 1024);
    expect((await collect(stream)).length).toBe(10 * 1024);
  });

  it('deletes the temp file after the disk stream is consumed', async () => {
    const { stream } = await resolveContent(makeStream(10, 1024), {
      memoryThresholdBytes: 1024,
      tmpDir: dir,
    });

    // While unread, exactly one temp file exists.
    expect(await tempFileCount()).toBe(1);

    await collect(stream);
    await delay(20); // let the 'close' cleanup run

    expect(await tempFileCount()).toBe(0);
  });

  it('preserves byte content exactly across the disk round-trip', async () => {
    const { stream } = await resolveContent(makeStream(8, 512, 0x7a), {
      memoryThresholdBytes: 1024,
      tmpDir: dir,
    });

    const out = await collect(stream);
    expect(out.every((b) => b === 0x7a)).toBe(true);
    expect(out.length).toBe(8 * 512);
  });

  it('handles an empty stream (size 0, no temp file)', async () => {
    const { size, stream } = await resolveContent(makeStream(0, 0), {
      memoryThresholdBytes: 1024,
      tmpDir: dir,
    });

    expect(size).toBe(0);
    expect((await collect(stream)).length).toBe(0);
    expect(await tempFileCount()).toBe(0);
  });

  it('cleans up the temp file if the source errors mid-stream', async () => {
    const boom = new Readable({
      read() {
        this.push(Buffer.alloc(2048, 0x61));
        this.destroy(new Error('boom'));
      },
    });

    await expect(
      resolveContent(boom, { memoryThresholdBytes: 512, tmpDir: dir })
    ).rejects.toThrow('boom');
    await delay(20);
    expect(await tempFileCount()).toBe(0);
  });
});
