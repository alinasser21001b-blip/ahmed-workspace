/**
 * Image sniffing.
 *
 * The client's `Content-Type` is a claim, not evidence. A file named `.png`
 * with `image/png` declared can be anything at all, so the real format is read
 * from the leading bytes and the declared type is discarded (§19: MIME
 * validation).
 *
 * Written by hand rather than pulled from a dependency because it is a hundred
 * lines of header parsing, and because an image library that decodes untrusted
 * bytes is a much larger attack surface than one that reads eight of them.
 * Dimensions come out of the same parse, which is what the client needs to
 * reserve layout space before the image loads.
 */

export interface ImageMeta {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number;
  height: number;
}

export function sniffImage(buffer: Buffer): ImageMeta | null {
  return sniffPng(buffer) ?? sniffJpeg(buffer) ?? sniffGif(buffer) ?? sniffWebp(buffer);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffPng(buffer: Buffer): ImageMeta | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // The IHDR chunk is required to be first, so width/height sit at fixed offsets.
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    mimeType: 'image/png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function sniffJpeg(buffer: Buffer): ImageMeta | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    return null;
  }

  // JPEG has no fixed header: walk the marker segments until a Start-Of-Frame,
  // which is the only place dimensions live.
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan — past this point is entropy-coded data, not headers.
    if (marker === 0xda) break;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      if (offset + 9 >= buffer.length) return null;
      return {
        mimeType: 'image/jpeg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function sniffGif(buffer: Buffer): ImageMeta | null {
  if (buffer.length < 10) return null;
  const header = buffer.toString('ascii', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;
  return {
    mimeType: 'image/gif',
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function sniffWebp(buffer: Buffer): ImageMeta | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const format = buffer.toString('ascii', 12, 16);

  // Lossy: dimensions follow the VP8 frame header's 3-byte start code.
  if (format === 'VP8 ') {
    return {
      mimeType: 'image/webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  // Lossless: 14 bits each, packed across four bytes.
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      mimeType: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  // Extended: 24-bit little-endian, stored minus one.
  if (format === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }

  return null;
}
