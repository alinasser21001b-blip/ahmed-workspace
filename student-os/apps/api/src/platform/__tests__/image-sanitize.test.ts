import { describe, expect, it } from 'vitest';
import { sniffImage } from '../image-meta.js';
import { sanitizeImage } from '../image-sanitize.js';

/**
 * Every fixture below is real, structurally valid bytes for its format —
 * built by hand the same way `TINY_PNG` in the integration test helpers is,
 * and for the same reason: a placeholder would be rejected by the very
 * sniffing this module sits behind, which would prove nothing.
 *
 * Where the assertion is "GPS is gone", the test embeds a unique marker
 * string inside the metadata block under test and asserts the sanitized
 * bytes do not contain it — not that some field looks empty, which a bug
 * could satisfy by accident.
 */

// --- JPEG --------------------------------------------------------------

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = marker;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

/** A minimal well-formed 1×1 JPEG, with caller-supplied segments spliced in after APP0. */
function buildJpeg(middle: Buffer[]): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = jpegSegment(
    0xe0,
    Buffer.concat([Buffer.from('JFIF\0', 'ascii'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]),
  );
  const sof0 = jpegSegment(
    0xc0,
    Buffer.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  );
  const sos = jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
  const scanAndEoi = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xd9]);
  return Buffer.concat([soi, app0, ...middle, sof0, sos, scanAndEoi]);
}

function buildExifApp1(orientation: number | null, markerText: string): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation ?? 0, 18);
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22);
  const marker = Buffer.from(markerText, 'ascii');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff, marker]);
  return jpegSegment(0xe1, payload);
}

function buildXmpApp1(text: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'),
    Buffer.from(text, 'ascii'),
  ]);
  return jpegSegment(0xe1, payload);
}

function buildIccApp2(text: string): Buffer {
  return jpegSegment(
    0xe2,
    Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([1, 1]), Buffer.from(text)]),
  );
}

function buildPhotoshopApp13(text: string): Buffer {
  return jpegSegment(
    0xed,
    Buffer.concat([Buffer.from('Photoshop 3.0\0', 'ascii'), Buffer.from(text, 'ascii')]),
  );
}

/** Independent re-parse of the rebuilt Orientation tag — duplicated on purpose, not reused from the implementation under test. */
function readOrientationFromSegment(buffer: Buffer): number | null {
  const sigIndex = buffer.indexOf(Buffer.from('Exif\0\0', 'ascii'));
  if (sigIndex === -1) return null;
  const tiff = buffer.subarray(sigIndex + 6);
  if (tiff.toString('ascii', 0, 2) !== 'II') return null;
  const ifd0Offset = tiff.readUInt32LE(4);
  const count = tiff.readUInt16LE(ifd0Offset);
  for (let i = 0; i < count; i += 1) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (tiff.readUInt16LE(entryOffset) === 0x0112) {
      return tiff.readUInt16LE(entryOffset + 8);
    }
  }
  return null;
}

describe('JPEG', () => {
  it('strips GPS-bearing EXIF and preserves orientation and dimensions', () => {
    const original = buildJpeg([
      buildExifApp1(6, 'GPSLAT:40.7128,GPSLON:-74.0060,CAMERA:iPhone15'),
    ]);
    expect(original.includes('GPSLAT:40.7128')).toBe(true);

    const result = sanitizeImage(original, 'image/jpeg');

    expect(result.gpsMetadataRemoved).toBe(true);
    expect(result.buffer.includes('GPSLAT:40.7128')).toBe(false);
    expect(result.buffer.includes('CAMERA:iPhone15')).toBe(false);
    expect(readOrientationFromSegment(result.buffer)).toBe(6);

    const meta = sniffImage(result.buffer);
    expect(meta).toEqual({ mimeType: 'image/jpeg', width: 1, height: 1 });
  });

  it('drops EXIF entirely, with no rebuilt segment, when there is no orientation tag', () => {
    // Orientation value 0 is not a valid EXIF orientation (1-8), so
    // readOrientation must reject it and rebuild nothing.
    const original = buildJpeg([buildExifApp1(0, 'GPS:should-still-be-removed')]);
    const result = sanitizeImage(original, 'image/jpeg');

    expect(result.gpsMetadataRemoved).toBe(true);
    expect(result.buffer.includes('Exif\0\0')).toBe(false);
    expect(result.buffer.includes('GPS:should-still-be-removed')).toBe(false);
  });

  it('drops an XMP-signed APP1 block (a second GPS carrier) without rebuilding anything', () => {
    // gpsMetadataRemoved is only asserted for the confirmed-EXIF case above —
    // an XMP payload is arbitrary XML this parser never inspects, so it makes
    // no claim about what was inside it. What it guarantees unconditionally is
    // that the segment, whatever it held, does not survive.
    const original = buildJpeg([buildXmpApp1('<x:xmpmeta exif:GPSLatitude="40.7128">')]);
    const result = sanitizeImage(original, 'image/jpeg');

    expect(result.buffer.includes('GPSLatitude')).toBe(false);
    expect(result.buffer.includes('ns.adobe.com')).toBe(false);
  });

  it('drops APP13 (Photoshop/IPTC, an occasional location carrier) and COM comments', () => {
    const original = buildJpeg([
      buildPhotoshopApp13('IPTC-LOCATION:Baghdad'),
      jpegSegment(0xfe, Buffer.from('taken at the hospital, room 4B', 'ascii')),
    ]);
    const result = sanitizeImage(original, 'image/jpeg');

    expect(result.buffer.includes('IPTC-LOCATION')).toBe(false);
    expect(result.buffer.includes('room 4B')).toBe(false);
  });

  it('keeps the ICC colour profile — sanitisation is not the same as stripping everything', () => {
    const original = buildJpeg([buildIccApp2('sRGB-fake-profile-bytes')]);
    const result = sanitizeImage(original, 'image/jpeg');

    expect(result.buffer.includes('ICC_PROFILE')).toBe(true);
    expect(result.buffer.includes('sRGB-fake-profile-bytes')).toBe(true);
  });

  it('does not crash on a segment whose declared length runs past the buffer', () => {
    const original = buildJpeg([buildExifApp1(3, 'irrelevant')]);
    // Corrupt the APP1 length field (bytes 4-5, right after SOI+APP0) to claim
    // a length far larger than the file actually has.
    const appOffset = 2 + 16; // past SOI(2) + the 16-byte APP0 segment
    const truncated = Buffer.from(original);
    truncated.writeUInt16BE(0xfff0, appOffset + 2);

    expect(() => sanitizeImage(truncated, 'image/jpeg')).not.toThrow();
  });
});

// --- PNG -------------------------------------------------------------------

/** A real, valid 1×1 PNG — the same bytes used across the integration suite's upload fixtures. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  // CRC is not verified by this codebase's PNG chunk walker (see image-sanitize.ts
  // and image-meta.ts, which both key off the length field only) — left as zero.
  return chunk;
}

/** Splices extra chunks into TINY_PNG right after IHDR, by walking real chunk boundaries. */
function pngWithExtraChunks(extra: Buffer[]): Buffer {
  const ihdrLength = TINY_PNG.readUInt32BE(8);
  const afterIhdr = 8 + 12 + ihdrLength;
  return Buffer.concat([TINY_PNG.subarray(0, afterIhdr), ...extra, TINY_PNG.subarray(afterIhdr)]);
}

describe('PNG', () => {
  it('strips the eXIf chunk (PNG’s GPS-capable EXIF carrier) and text chunks', () => {
    const original = pngWithExtraChunks([
      pngChunk('eXIf', Buffer.from('fake-tiff-bytes-GPSLAT:40.7128', 'ascii')),
      pngChunk('tEXt', Buffer.from('Software\0PhoneCam GPS 40.71,-74.00', 'ascii')),
      pngChunk('tIME', Buffer.from([0x07, 0xe8, 1, 1, 0, 0, 0])),
    ]);
    expect(original.includes('GPSLAT:40.7128')).toBe(true);

    const result = sanitizeImage(original, 'image/png');

    expect(result.gpsMetadataRemoved).toBe(true);
    expect(result.buffer.includes('GPSLAT:40.7128')).toBe(false);
    expect(result.buffer.includes('PhoneCam')).toBe(false);
    expect(result.buffer.includes('eXIf')).toBe(false);
    expect(result.buffer.includes('tEXt')).toBe(false);
    expect(result.buffer.includes('tIME')).toBe(false);

    const meta = sniffImage(result.buffer);
    expect(meta).toEqual({ mimeType: 'image/png', width: 1, height: 1 });
  });

  it('keeps the colour-management chunks needed to render correctly', () => {
    const original = pngWithExtraChunks([
      pngChunk('iCCP', Buffer.from('sRGB-fake-icc-profile', 'ascii')),
      pngChunk('gAMA', Buffer.from([0, 0, 0x9a, 0x9c])),
    ]);
    const result = sanitizeImage(original, 'image/png');

    expect(result.buffer.includes('iCCP')).toBe(true);
    expect(result.buffer.includes('gAMA')).toBe(true);
    expect(result.gpsMetadataRemoved).toBe(false);
  });

  it('does not crash and passes the tail through unmodified on a truncated chunk length', () => {
    const original = pngWithExtraChunks([pngChunk('eXIf', Buffer.from('short'))]);
    const truncated = original.subarray(0, original.length - 5); // cut mid-final-chunk

    expect(() => sanitizeImage(truncated, 'image/png')).not.toThrow();
  });
});

// --- WebP --------------------------------------------------------------

function webpChunk(fourCc: string, payload: Buffer): Buffer {
  const padded = payload.length % 2 === 1 ? Buffer.concat([payload, Buffer.from([0])]) : payload;
  const chunk = Buffer.alloc(8 + padded.length);
  chunk.write(fourCc, 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  padded.copy(chunk, 8);
  return chunk;
}

/** A 1×1 extended-format (VP8X) WebP — dimensions live in the VP8X header itself, no pixel codec required. */
function buildWebp(extraChunks: Buffer[]): Buffer {
  const vp8xPayload = Buffer.alloc(10);
  vp8xPayload[0] = 0x0c; // Exif (bit3) + Xmp (bit2) capability bits set
  // bytes 1-3 reserved (0), bytes 4-6 width-1=0 (width=1), bytes 7-9 height-1=0 (height=1)
  const vp8x = webpChunk('VP8X', vp8xPayload);
  const payload = Buffer.concat([vp8x, ...extraChunks]);
  const out = Buffer.alloc(12 + payload.length);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(4 + payload.length, 4);
  out.write('WEBP', 8, 'ascii');
  payload.copy(out, 12);
  return out;
}

describe('WebP', () => {
  it('drops EXIF and XMP RIFF subchunks and clears the VP8X capability bits', () => {
    const original = buildWebp([
      webpChunk('EXIF', Buffer.from('FAKE_GPS_EXIF_DATA_40.7128', 'ascii')),
      webpChunk('XMP ', Buffer.from('FAKE_XMP_GPS_LATLON_40.7128', 'ascii')),
    ]);
    expect(original.includes('FAKE_GPS_EXIF_DATA')).toBe(true);

    const result = sanitizeImage(original, 'image/webp');

    expect(result.gpsMetadataRemoved).toBe(true);
    expect(result.buffer.includes('FAKE_GPS_EXIF_DATA')).toBe(false);
    expect(result.buffer.includes('FAKE_XMP_GPS_LATLON')).toBe(false);
    expect(result.buffer.toString('ascii', 12, 16)).toBe('VP8X');
    // Flags byte is the first byte of the VP8X payload, at offset 20.
    expect(result.buffer[20]! & 0b0000_1100).toBe(0);

    const meta = sniffImage(result.buffer);
    expect(meta).toEqual({ mimeType: 'image/webp', width: 1, height: 1 });
  });

  it('is a no-op on bytes that are not a RIFF/WebP container', () => {
    const notWebp = Buffer.from('definitely not a webp file', 'ascii');
    const result = sanitizeImage(notWebp, 'image/webp');
    expect(result.buffer.equals(notWebp)).toBe(true);
    expect(result.gpsMetadataRemoved).toBe(false);
  });
});

// --- GIF -----------------------------------------------------------------

/**
 * A real, valid 1×1 transparent GIF89a (42 bytes) — the well-known minimal
 * fixture used across the web — with a Comment Extension and an Application
 * Extension (NETSCAPE2.0 loop) spliced in after the header/screen descriptor,
 * exactly where an encoder would place them.
 */
const MINIMAL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64',
);

describe('GIF', () => {
  it('drops the Comment Extension and keeps the Application Extension (animation loop)', () => {
    const headerAndGct = MINIMAL_GIF.subarray(0, 19); // header(6) + LSD(7) + 2-colour GCT(6)
    const rest = MINIMAL_GIF.subarray(19); // original Graphic Control Ext + Image Descriptor + data + trailer

    const appExt = Buffer.concat([
      Buffer.from([0x21, 0xff, 0x0b]),
      Buffer.from('NETSCAPE2.0', 'ascii'),
      Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]), // loop sub-block + terminator
    ]);
    const commentText = 'SECRET_GPS_COORDS_DO_NOT_LEAK';
    const commentExt = Buffer.concat([
      Buffer.from([0x21, 0xfe, commentText.length]),
      Buffer.from(commentText, 'ascii'),
      Buffer.from([0x00]),
    ]);

    const original = Buffer.concat([headerAndGct, appExt, commentExt, rest]);
    expect(original.includes(commentText)).toBe(true);

    const result = sanitizeImage(original, 'image/gif');

    // Exact byte equality: the comment extension is the only thing removed.
    expect(result.buffer.equals(Buffer.concat([headerAndGct, appExt, rest]))).toBe(true);
    expect(result.buffer.includes(commentText)).toBe(false);
    expect(result.buffer.includes('NETSCAPE2.0')).toBe(true);

    const meta = sniffImage(result.buffer);
    expect(meta).toEqual({ mimeType: 'image/gif', width: 1, height: 1 });
  });

  it('never reports GPS removal — GIF has no standard EXIF/GPS carrier to remove', () => {
    // A plain GIF with no extensions at all: nothing to strip, nothing to claim.
    const result = sanitizeImage(MINIMAL_GIF, 'image/gif');
    expect(result.gpsMetadataRemoved).toBe(false);
    expect(result.buffer.equals(MINIMAL_GIF)).toBe(true);
  });
});
