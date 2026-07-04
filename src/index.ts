import type { Readable } from 'node:stream';

import type { CreateArchiveOptions } from './types.js';

export type { ArchiveEntry, ArchiveFormat, CreateArchiveOptions } from './types.js';

/**
 * Create an archive (TAR or ZIP) as a Readable stream from entries whose byte
 * length may be unknown or unreliable.
 *
 * Strategy (implemented in later stages):
 *   - ZIP → stream entries directly; unsized entries use ZIP data descriptors,
 *           so no size is needed up front.
 *   - TAR → resolve each unsized entry's exact size first (buffer small entries
 *           in memory, spool large ones to a temp file), then write the entry.
 *
 * Memory stays bounded regardless of asset size — the reason to prefer this over
 * archiver's in-memory buffering of unsized TAR streams.
 *
 * @throws Not implemented until Stage 2+.
 */
export function createArchive(_options: CreateArchiveOptions): Readable {
  throw new Error('safe-stream-archiver: createArchive is not implemented yet (Stage 2+).');
}
