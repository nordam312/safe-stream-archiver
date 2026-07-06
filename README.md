# safe-stream-archiver

Archive `Readable` streams whose byte length is **unknown or unreliable** — e.g. remote cloud assets (Cloudinary, S3) — into **TAR** or **ZIP**, without crashing, and with **bounded memory** regardless of asset size.

This solves a real class of bug in data-transfer tools: piping a remote stream into a TAR archive fails when the stream lacks a trustworthy `Content-Length` (chunked transfer encoding, or a compressed size that doesn't match the decompressed bytes). A TAR entry needs the exact size *before* its bytes are written — so an unknown size crashes the archive.

## Install

```bash
npm install safe-stream-archiver
```

Node >= 18. Ships ESM + CJS with types.

## Usage

`entries` is an (async) iterable, so you can produce entries lazily and with backpressure — one in flight at a time.

```ts
import { createArchive } from 'safe-stream-archiver';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

async function* entries() {
  // Each stream's size may be unknown — that's fine.
  yield { name: 'uploads/logo.svg', stream: await fetchRemote('https://cdn/.../logo.svg') };
  yield { name: 'uploads/photo.jpg', stream: await fetchRemote('https://cdn/.../photo.jpg') };
}

const archive = createArchive({ format: 'tar', entries: entries() });
await pipeline(archive, createWriteStream('backup.tar'));
```

ZIP is the same call with `format: 'zip'`:

```ts
const archive = createArchive({ format: 'zip', entries: entries() });
```

If you already know a **trustworthy** size (e.g. a local file's `fs.stat`), pass it to skip all buffering:

```ts
yield { name: 'local.bin', stream, size: stats.size };
```

> Don't pass an HTTP `content-length` as `size` unless you trust it — that's the trap this package exists to avoid.

## How it works

The right strategy depends on the **format**, not the library:

- **TAR** needs the exact size in each entry header *before* the data. For an unsized entry, the content is resolved first: **buffered in memory up to a threshold, then spooled to a temp file** beyond it. So a multi-GB asset is measured on disk, never on the heap. The temp file is deleted when its stream closes (and on error).
- **ZIP** supports entries of unknown size via **data descriptors** (the CRC/sizes are written *after* the data). Unsized entries are **streamed directly** — no resolving, no spooling.

Either way, memory stays bounded regardless of asset size.

## Comparison with `archiver`

[`archiver`](https://www.npmjs.com/package/archiver) is the go-to, more feature-rich library. The relevant difference: for a TAR stream of **unknown size**, `archiver` buffers the **entire stream in memory** (`collectStream`) to compute the size. That risks heap exhaustion for large assets.

`safe-stream-archiver` **spools unsized TAR entries to disk instead**, keeping memory bounded. If you need archiver's broader feature set and your unsized assets are small, use archiver. If you archive large unsized remote assets, this keeps you off the heap.

## API

```ts
function createArchive(options: CreateArchiveOptions): Readable;

interface CreateArchiveOptions {
  format: 'tar' | 'zip';
  entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>;
  /** TAR only: buffer in memory up to this many bytes, spool to disk beyond it. Default 1 MiB. */
  memoryThresholdBytes?: number;
  /** TAR only: directory for temp files when spooling. Default os.tmpdir(). */
  tmpDir?: string;
}

interface ArchiveEntry {
  name: string;      // path inside the archive
  stream: Readable;  // content; byte length may be unknown
  size?: number;     // optional TRUSTWORTHY size; resolved automatically if omitted
}
```

Returns a `Readable` you can pipe anywhere (a file, an HTTP response, an S3 upload).

## Limitations

- TAR spooling uses **transient disk space** for an unsized entry while it's written into the archive (then the temp file is removed). If you're on a read-only/space-constrained filesystem, provide a trusted `size` to stream directly.
- `memoryThresholdBytes` / `tmpDir` apply to **TAR only** (ZIP never spools).

## License

MIT
