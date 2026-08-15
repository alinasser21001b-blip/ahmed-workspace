import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/platform/db.js';
import { closeApp, getApp, onboardedUser, uploadImage } from './helpers.js';

/**
 * App Store readiness — uploaded image metadata privacy.
 *
 * `image-sanitize.test.ts` proves the container-level parsing in isolation.
 * This proves the thing a reviewer and a court both actually care about: a
 * photo posted through the real HTTP upload route, read back through the real
 * signed-URL serving route, does not carry the GPS coordinates it walked in
 * with — end to end, through the actual multipart parser, the actual storage
 * driver and the actual database row.
 */

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = marker;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

/** A real, valid 1×1 JPEG carrying a GPS-bearing EXIF block and an orientation tag. */
function jpegWithGps(orientation: number, gpsMarker: string): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); // Orientation tag
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22);
  const exifPayload = Buffer.concat([
    Buffer.from('Exif\0\0', 'ascii'),
    tiff,
    Buffer.from(gpsMarker, 'ascii'),
  ]);
  const app1 = jpegSegment(0xe1, exifPayload);

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
  return Buffer.concat([soi, app0, app1, sof0, sos, scanAndEoi]);
}

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

describe('uploaded image metadata is stripped server-side', () => {
  it('a JPEG carrying GPS EXIF is stored and served without the coordinates', async () => {
    const student = await onboardedUser();
    const original = jpegWithGps(6, 'GPSLAT:40.7128,GPSLON:-74.0060,DEVICE:iPhone15Pro');
    expect(original.includes('GPSLAT:40.7128')).toBe(true);

    const upload = await uploadImage(student.session, original, 'photo.jpg', 'image/jpeg');
    expect(upload.statusCode).toBe(201);
    expect(upload.body.width).toBe(1);

    const app = await getApp();
    const raw = await app.inject({ method: 'GET', url: upload.body.url });
    expect(raw.statusCode).toBe(200);

    const served = raw.rawPayload;
    expect(served.includes('GPSLAT:40.7128')).toBe(false);
    expect(served.includes('DEVICE:iPhone15Pro')).toBe(false);
    // Not merely absent from a truncated response — the served bytes are a
    // structurally valid JPEG a viewer can still open.
    expect(served[0]).toBe(0xff);
    expect(served[1]).toBe(0xd8);
  });

  it('does not trust a client claim that the file is already clean — sanitisation runs unconditionally', async () => {
    // No client-side flag exists in this API to skip sanitisation, and this
    // test is the guard against one ever being added silently: the route
    // takes bytes and a declared MIME type only, so there is no parameter to
    // request an exemption. If that ever changes, this assertion is the one
    // that should force the change to be deliberate.
    const student = await onboardedUser();
    const original = jpegWithGps(1, 'GPS_SHOULD_NEVER_SURVIVE_REGARDLESS_OF_CLIENT_CLAIMS');
    const upload = await uploadImage(student.session, original, 'trusted.jpg', 'image/jpeg');

    const app = await getApp();
    const raw = await app.inject({ method: 'GET', url: upload.body.url });
    expect(raw.rawPayload.includes('GPS_SHOULD_NEVER_SURVIVE')).toBe(false);
  });

  it('rejects a file whose bytes cannot be parsed as any supported image, safely', async () => {
    const student = await onboardedUser();
    const garbage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]); // JPEG-looking, structurally broken
    const upload = await uploadImage(student.session, garbage, 'broken.jpg', 'image/jpeg');
    // sniffJpeg requires a real SOF/dimensions to succeed; malformed bytes are
    // refused at the format-sniffing gate before sanitisation ever runs.
    expect(upload.statusCode).toBe(415);
  });
});
