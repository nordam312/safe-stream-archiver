import { pipeline } from 'node:stream/promises';

import { pack } from 'tar-stream';

import { resolveContent } from './size-resolver.js';

import type { Readable } from 'node:stream';
import type { ArchiveEntry, CreateArchiveOptions } from './types.js';

type TarOptions = Pick<CreateArchiveOptions, 'memoryThresholdBytes' | 'tmpDir'>;

/**
 * Build a TAR archive as a Readable stream from entries whose byte length may be
 * unknown.
 *
 * TAR requires the exact size in each entry's header BEFORE any bytes are
 * written, so an entry without a trusted `size` is resolved first (buffered in
 * memory or spooled to disk by the size resolver) to get its real length. This
 * is what prevents the "Failed to create an asset tar entry" class of crash.
 *
 * Entries are processed one at a time, and the returned stream's consumer drives
 * backpressure all the way back to the source — so memory stays bounded.
 */
export function createTarArchive(
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>,
  options: TarOptions = {}
): Readable {
  const archive = pack();

  const run = async (): Promise<void> => {
    for await (const entry of entries) {
      // Fast path: a trusted size means we can stream straight through.
      // Otherwise resolve the exact size (bounded memory) before writing the header.
      const resolved =
        entry.size === undefined
          ? await resolveContent(entry.stream, options)
          : { size: entry.size, stream: entry.stream };

      const tarEntry = archive.entry({ name: entry.name, size: resolved.size });
      // pipeline pipes the content into the tar entry with backpressure and
      // rejects if either side errors.
      await pipeline(resolved.stream, tarEntry);
    }

    archive.finalize();
  };

  run().catch((error: unknown) => {
    archive.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return archive;
}
