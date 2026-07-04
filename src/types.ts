import type { Readable } from 'node:stream';

/** One item to place into the archive. */
export interface ArchiveEntry {
  /** Path of the entry inside the archive, e.g. "uploads/logo.svg". */
  name: string;
  /** The entry's content. Its byte length may be unknown. */
  stream: Readable;
  /**
   * The exact byte length, IF the caller already knows a trustworthy value
   * (e.g. a local file's `fs.stat` size). If omitted, the archiver resolves it
   * itself — the whole point of this package. Do NOT pass an HTTP
   * `content-length` here unless you trust it (it's often wrong for cloud CDNs).
   */
  size?: number;
}

export type ArchiveFormat = 'tar' | 'zip';

export interface CreateArchiveOptions {
  /** Output format. TAR needs an exact size per entry; ZIP can stream unsized. */
  format: ArchiveFormat;
  /**
   * The entries to archive. Accepts an async iterable so callers can produce
   * entries lazily and with backpressure (e.g. a DB cursor that fetches each
   * remote asset just in time) — one entry in flight at a time, bounded memory.
   */
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>;
  /**
   * When an entry's size is unknown and the format needs it up front (TAR),
   * buffer the stream in memory up to this many bytes; spool to a temp file
   * beyond it. This bounds memory regardless of asset size. Default: 1 MiB.
   */
  memoryThresholdBytes?: number;
  /** Directory to use for temp files when spooling. Default: `os.tmpdir()`. */
  tmpDir?: string;
}
