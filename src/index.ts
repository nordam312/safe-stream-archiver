import { createTarArchive } from './tar-archive.js';
import { createZipArchive } from './zip-archive.js';

import type { Readable } from 'node:stream';
import type { CreateArchiveOptions } from './types.js';

export type { ArchiveEntry, ArchiveFormat, CreateArchiveOptions } from './types.js';

/**
 * Create an archive (TAR or ZIP) as a Readable stream from entries whose byte
 * length may be unknown or unreliable.
 *
 *   - TAR → each unsized entry's exact size is resolved first (buffered in
 *           memory below a threshold, spooled to a temp file above it), then the
 *           entry is written. Memory stays bounded regardless of asset size.
 *   - ZIP → (Stage 4) streamed directly using data descriptors, so no size is
 *           needed up front.
 */
export function createArchive(options: CreateArchiveOptions): Readable {
  switch (options.format) {
    case 'tar':
      return createTarArchive(options.entries, options);
    case 'zip':
      return createZipArchive(options.entries);
    default:
      throw new Error(`safe-stream-archiver: unknown format "${String(options.format)}".`);
  }
}
