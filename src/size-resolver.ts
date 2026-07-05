import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { createTempFilePath, removeTempFile } from './temp.js';

import type { Writable } from 'node:stream';

/** The result of resolving a stream's exact size. */
export interface ResolvedContent {
  /** The exact byte length of the content. */
  size: number;
  /** A fresh, replayable stream of the same bytes (from memory or from disk). */
  stream: Readable;
}

export interface ResolveOptions {
  /** Buffer in memory up to this many bytes; spool to a temp file beyond it. */
  memoryThresholdBytes?: number;
  /** Directory for the temp file when spooling. */
  tmpDir?: string;
}

/** 1 MiB — small enough to stay cheap, large enough to keep most files in memory. */
const DEFAULT_THRESHOLD = 1024 * 1024;

const toBuffer = (chunk: unknown): Buffer =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);

/** Write a chunk and wait for backpressure to clear. `events.once` rejects if the
 *  stream emits `error` while we wait, so write failures surface here. */
async function write(target: Writable, chunk: Buffer): Promise<void> {
  if (!target.write(chunk)) {
    await once(target, 'drain');
  }
}

/**
 * Consume a stream of unknown length exactly once and return its exact size plus
 * a fresh, replayable stream of the same bytes.
 *
 * Memory is bounded: bytes are buffered in memory only up to
 * `memoryThresholdBytes`. The moment the content would exceed that, everything
 * buffered so far — and the rest of the stream — is spooled to a temp file on
 * disk, so a multi-GB asset never lands in the heap.
 *
 * - Small content (≤ threshold) → returned from memory, no disk I/O.
 * - Large content (> threshold) → returned as a disk read stream that deletes
 *   its temp file once fully read (or on error).
 */
export async function resolveContent(
  source: Readable,
  options: ResolveOptions = {}
): Promise<ResolvedContent> {
  const threshold = options.memoryThresholdBytes ?? DEFAULT_THRESHOLD;

  const chunks: Buffer[] = [];
  let bufferedBytes = 0;
  let tempPath: string | undefined;
  let diskStream: Writable | undefined;

  try {
    for await (const raw of source) {
      const chunk = toBuffer(raw);

      if (diskStream) {
        // Already spilling — everything goes straight to disk.
        await write(diskStream, chunk);
      } else if (bufferedBytes + chunk.length > threshold) {
        // Crossing the threshold: open the temp file, flush what we buffered so
        // far, then this chunk. From here on we stream to disk.
        tempPath = createTempFilePath(options.tmpDir);
        diskStream = createWriteStream(tempPath);
        for (const buffered of chunks) {
          await write(diskStream, buffered);
        }
        chunks.length = 0;
        bufferedBytes = 0;
        await write(diskStream, chunk);
      } else {
        // Still under threshold: keep it in memory.
        chunks.push(chunk);
        bufferedBytes += chunk.length;
      }
    }

    if (diskStream && tempPath) {
      diskStream.end();
      await finished(diskStream); // flush + surface any write error
      const { size } = await stat(tempPath);
      const stream = createReadStream(tempPath);
      // Delete the temp file once its stream is fully consumed (or errors).
      stream.once('close', () => {
        void removeTempFile(tempPath as string);
      });
      return { size, stream };
    }

    // Stayed within the memory budget — no disk needed.
    const buffer = Buffer.concat(chunks, bufferedBytes);
    return { size: buffer.length, stream: Readable.from(buffer) };
  } catch (error) {
    if (diskStream && !diskStream.destroyed) {
      diskStream.destroy();
    }
    if (tempPath) {
      await removeTempFile(tempPath);
    }
    throw error;
  }
}
