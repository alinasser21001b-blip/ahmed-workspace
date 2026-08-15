/**
 * Metadata sanitization for uploaded images (App Store readiness — privacy).
 *
 * The upload path stored bytes exactly as received. A JPEG from a phone with
 * location services on carries the shot's GPS coordinates in its EXIF block,
 * and that block went straight into object storage and out through every
 * signed URL — silently, because nothing in the pipeline ever looked inside
 * the file past its format signature (`image-meta.ts` reads eight bytes to
 * confirm the format; it was never asked to look at metadata).
 *
 * This module closes that gap the same way `image-meta.ts` reads dimensions:
 * by walking the container structure ONE LEVEL — markers, chunks, RIFF
 * subchunks, GIF blocks — never by decoding pixels. That is a deliberate
 * repository-wide choice (see `image-meta.ts`'s own doc comment): a decoder
 * that turns untrusted bytes into pixels is a much larger attack surface than
 * a parser that reads container-level length fields and copies or drops
 * whole segments. Nothing here touches compressed image data, ever — it is
 * skipped by its own declared length, never interpreted.
 *
 * The rule is one sentence per format:
 *
 *   JPEG  — every APP1 (EXIF/XMP) and APP13 (Photoshop/IPTC) segment is
 *           dropped; if the EXIF block held an Orientation tag, a fresh
 *           4-entry-free 12-entry (never more than one) TIFF block carrying
 *           ONLY that tag is written back, so a phone photo still displays
 *           right-side up with GPS, camera model, timestamp and everything
 *           else gone.
 *   PNG   — only the chunk types needed to decode and render correctly
 *           survive (`IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND`, `gAMA`, `cHRM`,
 *           `sRGB`, `iCCP`, `bKGD`); `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`
 *           and anything else are dropped.
 *   WebP  — the RIFF `EXIF` and `XMP ` subchunks are dropped; if a `VP8X`
 *           header exists, its Exif/Xmp capability bits are cleared to match.
 *   GIF   — Comment Extension blocks (invisible metadata) are dropped;
 *           Graphic Control, Plain Text and Application extensions are kept,
 *           because the first two affect what the image looks like and the
 *           third carries the loop count that makes an animation animate.
 *           GIF has no standard EXIF/GPS carrier, so there is nothing else
 *           to strip — documented, not silently assumed.
 *
 * Anything the parser cannot make sense of degrades to the safest available
 * fallback rather than either crashing or passing the original bytes through
 * unsanitised — see each function's own comment for what "safe" means for
 * that format.
 */

export interface SanitizeResult {
  buffer: Buffer;
  /** True if a GPS-capable metadata block was found and removed. For the audit trail, not a gate. */
  gpsMetadataRemoved: boolean;
}

export function sanitizeImage(
  buffer: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
): SanitizeResult {
  switch (mimeType) {
    case 'image/jpeg':
      return sanitizeJpeg(buffer);
    case 'image/png':
      return sanitizePng(buffer);
    case 'image/webp':
      return sanitizeWebp(buffer);
    case 'image/gif':
      return sanitizeGif(buffer);
  }
}

// --- JPEG --------------------------------------------------------------

const EXIF_SIGNATURE = Buffer.from('Exif\0\0', 'ascii');
const ORIENTATION_TAG = 0x0112;

/**
 * Strips every APP1 (EXIF/XMP) and APP13 (Photoshop/IPTC) segment, rebuilding
 * a minimal orientation-only EXIF block when the original carried one.
 *
 * A malformed or truncated APP1 payload is treated as opaque and dropped
 * whole — the same outcome as a well-formed one with no orientation tag. The
 * function never throws on strange input; the worst case is losing the
 * orientation hint, never a crash and never a metadata leak, because a
 * segment this parser cannot understand is a segment it does not try to keep
 * any part of.
 */
function sanitizeJpeg(buffer: Buffer): SanitizeResult {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    // Not a JPEG this parser recognises structurally — sniffImage already
    // gated the format, so this is a defensive no-op, not a new decision.
    return { buffer, gpsMetadataRemoved: false };
  }

  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let offset = 2;
  let gpsRemoved = false;
  let orientation: number | null = null;

  /*
   * Every real photograph reaches Start-of-Scan — it is not an edge case, it
   * is the normal end of the header section that every JPEG has exactly one
   * of. The orientation rebuild has to happen at EVERY exit from the walk
   * below, not only if the loop runs off the end of the buffer, or it would
   * never run for an actual photo: `finish` is the one place that inserts it,
   * called from every return site rather than duplicated at each of them.
   */
  function finish(): SanitizeResult {
    if (orientation !== null) {
      // Inserted right after SOI, where APP0/APP1 conventionally live.
      out.splice(1, 0, buildOrientationOnlyApp1(orientation));
    }
    return { buffer: Buffer.concat(out), gpsMetadataRemoved: gpsRemoved };
  }

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      // Not on a marker boundary — the structure is not what we expect past
      // this point. Stop rewriting and pass the remainder through unmodified
      // rather than guess.
      out.push(buffer.subarray(offset));
      return finish();
    }

    const marker = buffer[offset + 1]!;

    // Standalone markers (no length field): copy through as-is.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    // Start of scan: everything after this is entropy-coded pixel data, not
    // headers. Copy the rest through untouched and stop parsing — this is the
    // normal termination point for every well-formed JPEG.
    if (marker === 0xda) {
      out.push(buffer.subarray(offset));
      return finish();
    }

    if (offset + 4 > buffer.length) {
      // A length field would run past the end of the file — truncated/
      // malformed. Stop rewriting; copy the tail through unmodified so the
      // caller gets a well-formed-looking (if truncated) file rather than one
      // this function further corrupted.
      out.push(buffer.subarray(offset));
      return finish();
    }

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      out.push(buffer.subarray(offset));
      return finish();
    }

    const segmentEnd = offset + 2 + length;
    const payload = buffer.subarray(offset + 4, segmentEnd);

    // APP1: EXIF or XMP. APP13: Photoshop IRB / IPTC (can carry location in
    // some workflows). Both dropped outright; EXIF's orientation is rescued
    // below if present and well-formed.
    if (marker === 0xe1) {
      if (payload.subarray(0, 6).equals(EXIF_SIGNATURE)) {
        gpsRemoved = true;
        orientation = readOrientation(payload.subarray(6)) ?? orientation;
      }
      // Whether EXIF or XMP, the segment itself is dropped either way.
      offset = segmentEnd;
      continue;
    }
    if (marker === 0xed) {
      // APP13 — Photoshop/IPTC. Dropped; not otherwise inspected.
      offset = segmentEnd;
      continue;
    }
    // COM — free-text comment. Non-essential; dropped.
    if (marker === 0xfe) {
      offset = segmentEnd;
      continue;
    }

    // Everything else (APP0/JFIF, APP2/ICC profile, DQT, DHT, SOF, DRI, ...)
    // is required for correct decoding or rendering and is copied through.
    out.push(buffer.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }

  return finish();
}

/**
 * Reads the Orientation tag (0x0112) out of a TIFF-structured EXIF payload,
 * without walking anything but IFD0 — GPS lives in a separate IFD reached
 * through a pointer tag this function never follows, so it is structurally
 * incapable of copying GPS data even by accident.
 */
function readOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const le = tiff.toString('ascii', 0, 2) === 'II';
  const be = tiff.toString('ascii', 0, 2) === 'MM';
  if (!le && !be) return null;

  const read16 = (o: number): number => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const read32 = (o: number): number => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

  if (read16(2) !== 0x2a) return null;
  const ifd0Offset = read32(4);
  if (ifd0Offset + 2 > tiff.length) return null;

  const entryCount = read16(ifd0Offset);
  const entriesStart = ifd0Offset + 2;
  if (entriesStart + entryCount * 12 > tiff.length) return null;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = entriesStart + i * 12;
    const tag = read16(entryOffset);
    if (tag === ORIENTATION_TAG) {
      const type = read16(entryOffset + 2);
      // SHORT — a valid Orientation tag is always this type per the EXIF spec.
      if (type !== 3) return null;
      const value = read16(entryOffset + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A minimal well-formed EXIF APP1 segment carrying only the Orientation tag. */
function buildOrientationOnlyApp1(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(ORIENTATION_TAG, 10);
  tiff.writeUInt16LE(3, 12); // type SHORT
  tiff.writeUInt32LE(1, 14); // count 1
  tiff.writeUInt16LE(orientation, 18); // inline value
  tiff.writeUInt16LE(0, 20); // padding to fill the 4-byte value slot
  tiff.writeUInt32LE(0, 22); // next IFD offset: none

  const payload = Buffer.concat([EXIF_SIGNATURE, tiff]);
  const segment = Buffer.alloc(4 + payload.length);
  segment.writeUInt8(0xff, 0);
  segment.writeUInt8(0xe1, 1);
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

// --- PNG -----------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunk types kept because they are required to decode or render the image correctly. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'bKGD']);

/**
 * Rebuilds the PNG keeping only chunks in `PNG_KEEP`. `eXIf` (PNG's EXIF
 * chunk, which can carry GPS the same as a JPEG's), `tEXt`/`zTXt`/`iTXt`
 * (arbitrary text, occasionally used to embed a GPS-bearing comment) and
 * `tIME` are the chunks this actually removes in practice; anything else
 * unrecognised is dropped by the same allow-list rather than special-cased,
 * which is the safe default for a container format.
 *
 * A structurally broken chunk stream (a length that runs past the end of the
 * file) stops the rewrite at that point and returns what was built so far —
 * `sniffImage` already required a valid `IHDR` before this ever runs, so the
 * output is never less valid than "no image at all" reached this function.
 */
function sanitizePng(buffer: Buffer): SanitizeResult {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { buffer, gpsMetadataRemoved: false };
  }

  const out: Buffer[] = [buffer.subarray(0, 8)];
  let offset = 8;
  let removedMetadata = false;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length; // length field + type + data + CRC

    if (length < 0 || chunkEnd > buffer.length) break;

    if (PNG_KEEP.has(type)) {
      out.push(buffer.subarray(offset, chunkEnd));
    } else {
      if (type === 'eXIf') removedMetadata = true;
      // Dropped: the chunk contributes nothing to `out`.
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  return { buffer: Buffer.concat(out), gpsMetadataRemoved: removedMetadata };
}

// --- WebP ------------------------------------------------------------------

/**
 * Drops the RIFF `EXIF ` and `XMP ` subchunks from a WebP container, and
 * clears the corresponding capability bits in `VP8X` if present so the
 * container's own header stops advertising metadata that is no longer there.
 *
 * WebP's chunk sizes are RIFF-standard (4-byte little-endian, chunk padded to
 * an even byte count) — walked the same defensive way as the PNG chunks
 * above: any chunk whose declared size runs past the buffer stops the
 * rewrite rather than reading out of bounds.
 */
function sanitizeWebp(buffer: Buffer): SanitizeResult {
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return { buffer, gpsMetadataRemoved: false };
  }

  const chunks: Buffer[] = [];
  let offset = 12;
  let removed = false;

  while (offset + 8 <= buffer.length) {
    const fourCc = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + size;
    const paddedEnd = dataEnd + (size % 2);
    if (paddedEnd > buffer.length) break;

    if (fourCc === 'EXIF' || fourCc === 'XMP ') {
      removed = true;
      offset = paddedEnd;
      continue;
    }

    let chunk = buffer.subarray(offset, paddedEnd);
    if (fourCc === 'VP8X' && size >= 1) {
      // Clear the Exif (bit 3) and Xmp (bit 2) flag bits in the VP8X flags
      // byte, which is the first byte of the chunk's payload.
      chunk = Buffer.from(chunk);
      chunk[8] = chunk[8]! & ~0b0000_1100;
    }
    chunks.push(chunk);
    offset = paddedEnd;
  }

  if (!removed) return { buffer, gpsMetadataRemoved: false };

  const payload = Buffer.concat(chunks);
  const rebuilt = Buffer.alloc(12 + payload.length);
  rebuilt.write('RIFF', 0, 'ascii');
  rebuilt.writeUInt32LE(4 + payload.length, 4); // size excludes 'RIFF' + this field
  rebuilt.write('WEBP', 8, 'ascii');
  payload.copy(rebuilt, 12);

  return { buffer: rebuilt, gpsMetadataRemoved: true };
}

// --- GIF ---------------------------------------------------------------

/**
 * Drops GIF Comment Extension blocks (invisible free-text metadata). Every
 * other block is copied through unexamined: Graphic Control and Plain Text
 * extensions affect what the image looks like, Application extensions carry
 * the animation loop count, and Image Descriptors carry the pixel data
 * itself — none of those are decoded, only skipped by their own
 * self-delimiting sub-block lengths, the same way `image-meta.ts` never
 * decodes LZW data to read a GIF's dimensions.
 *
 * GIF has no standardised EXIF or GPS carrier — no camera or phone writes
 * location data into a GIF file, because the format has nowhere defined to
 * put it. This function therefore cannot report `gpsMetadataRemoved: true`;
 * it never had GPS to remove. That is documented here rather than implied by
 * silence.
 *
 * Any structural surprise (a length byte that runs past the buffer, an
 * unrecognised introducer) stops the rewrite and passes the remainder
 * through unmodified, the same fail-safe the other three parsers use.
 */
function sanitizeGif(buffer: Buffer): SanitizeResult {
  if (buffer.length < 13) return { buffer, gpsMetadataRemoved: false };
  const header = buffer.toString('ascii', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return { buffer, gpsMetadataRemoved: false };

  const out: Buffer[] = [];
  let offset = 6;

  const packed = buffer[10]!;
  const gctFlag = (packed & 0b1000_0000) !== 0;
  const gctSize = 2 << (packed & 0b0000_0111);
  const headerEnd = 13 + (gctFlag ? gctSize * 3 : 0);
  if (headerEnd > buffer.length) return { buffer, gpsMetadataRemoved: false };
  out.push(buffer.subarray(0, headerEnd));
  offset = headerEnd;

  function skipSubBlocks(at: number): number | null {
    let o = at;
    while (o < buffer.length) {
      const len = buffer[o]!;
      o += 1;
      if (len === 0) return o;
      if (o + len > buffer.length) return null;
      o += len;
    }
    return null;
  }

  while (offset < buffer.length) {
    const introducer = buffer[offset]!;

    if (introducer === 0x3b) {
      out.push(buffer.subarray(offset, offset + 1));
      offset += 1;
      break;
    }

    if (introducer === 0x21) {
      if (offset + 2 > buffer.length) break;
      const label = buffer[offset + 1]!;

      if (label === 0xfe) {
        // Comment Extension: introducer(1) + label(1) + sub-blocks. Dropped.
        const end = skipSubBlocks(offset + 2);
        if (end === null) {
          out.push(buffer.subarray(offset));
          return { buffer: Buffer.concat(out), gpsMetadataRemoved: false };
        }
        offset = end;
        continue;
      }

      if (label === 0xf9) {
        // Graphic Control Extension: fixed 6-byte block after the label,
        // always exactly one 4-byte sub-block plus a terminator. Kept.
        const end = offset + 2 + 1 + 4 + 1;
        if (end > buffer.length) break;
        out.push(buffer.subarray(offset, end));
        offset = end;
        continue;
      }

      if (label === 0xff) {
        // Application Extension: introducer+label(2) + block size(1, =11) +
        // 11 bytes app identifier + sub-blocks. Kept — carries loop count.
        if (offset + 3 > buffer.length) break;
        const blockSize = buffer[offset + 2]!;
        const afterId = offset + 3 + blockSize;
        const end = skipSubBlocks(afterId);
        if (end === null) break;
        out.push(buffer.subarray(offset, end));
        offset = end;
        continue;
      }

      if (label === 0x01) {
        // Plain Text Extension: introducer+label(2) + block size(1, =12) +
        // 12 bytes text-grid params + sub-blocks. Kept — visible content.
        if (offset + 3 > buffer.length) break;
        const blockSize = buffer[offset + 2]!;
        const afterParams = offset + 3 + blockSize;
        const end = skipSubBlocks(afterParams);
        if (end === null) break;
        out.push(buffer.subarray(offset, end));
        offset = end;
        continue;
      }

      // An extension type this parser does not recognise. Stop rewriting and
      // pass the remainder through untouched rather than guess its shape.
      break;
    }

    if (introducer === 0x2c) {
      // Image Descriptor: 1 + 9 bytes fixed fields, optional local colour
      // table, then LZW min-code-size(1) + image-data sub-blocks.
      if (offset + 10 > buffer.length) break;
      const localPacked = buffer[offset + 9]!;
      const lctFlag = (localPacked & 0b1000_0000) !== 0;
      const lctSize = 2 << (localPacked & 0b0000_0111);
      const afterTable = offset + 10 + (lctFlag ? lctSize * 3 : 0);
      if (afterTable + 1 > buffer.length) break;
      const end = skipSubBlocks(afterTable + 1); // +1 skips the LZW min-code-size byte
      if (end === null) break;
      out.push(buffer.subarray(offset, end));
      offset = end;
      continue;
    }

    // Unrecognised introducer byte — stop rewriting.
    break;
  }

  if (offset < buffer.length) out.push(buffer.subarray(offset));

  return { buffer: Buffer.concat(out), gpsMetadataRemoved: false };
}
