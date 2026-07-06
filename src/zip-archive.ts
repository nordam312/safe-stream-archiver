import { ZipFile } from 'yazl';

import type { Readable } from 'node:stream';
import type { ArchiveEntry } from './types.js';

/**
 * Build a ZIP archive as a Readable stream from entries whose byte length may be
 * unknown.
 *
 * Unlike TAR, the ZIP format supports entries of UNKNOWN size: the CRC-32 and
 * sizes are written in a "data descriptor" AFTER the entry's data (general
 * purpose bit 3). `yazl` streams each entry through CRC/size counters straight
 * to the output — it never buffers the whole thing — so there is no size to
 * resolve and nothing to spool. `size` on an entry is simply ignored here.
 *
 * This is the interesting contrast with the TAR engine: the archive format,
 * not the library, decides whether unsized streaming is even possible.
 */
export function createZipArchive(
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>
): Readable {
  const zip = new ZipFile();
  // @types/yazl types outputStream as the legacy ReadableStream (no destroy),
  // but at runtime it is a full Readable.
  const output = zip.outputStream as Readable;

  const fail = (error: unknown): void => {
    output.destroy(error instanceof Error ? error : new Error(String(error)));
  };

  const run = async (): Promise<void> => {
    for await (const entry of entries) {
      // yazl pipes each source internally and does NOT forward a read error to
      // the output stream, so we wire each source's error to fail the archive.
      entry.stream.once('error', fail);
      zip.addReadStream(entry.stream, entry.name);
    }
    zip.end();
  };

  run().catch(fail);
  zip.on('error', fail); // yazl-level errors (e.g. invalid input)

  return output;
}
