/**
 * Test-environment polyfills. Not shipped, not imported by application code.
 *
 * pdfjs-dist@6 targets engines newer than any released Node. It calls two
 * Stage-3 proposals that Cloudflare's workerd provides and Node does not:
 *
 *   Uint8Array.prototype.toHex   - used when hashing embedded font programs
 *   Math.sumPrecise              - used in glyph metric accumulation
 *
 * Without these the PDF parser throws, and lib/knowledge/extractor.ts reports
 * the failure as TEXT_EXTRACTION_FAILED, which is indistinguishable from a
 * genuinely unreadable file. The application needs no change - it runs on
 * workerd - so the shim belongs here, in the test harness, and nowhere else.
 *
 * Verified absent on Node 22.22.2 and Node 24.10.0.
 */

interface HexCapableUint8Array {
  toHex?(): string;
}

if (typeof (Uint8Array.prototype as HexCapableUint8Array).toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true,
    writable: true,
    value: function toHex(this: Uint8Array): string {
      let out = '';
      for (const byte of this) out += byte.toString(16).padStart(2, '0');
      return out;
    },
  });
}

if (typeof (Uint8Array as unknown as { fromHex?: unknown }).fromHex !== 'function') {
  Object.defineProperty(Uint8Array, 'fromHex', {
    configurable: true,
    writable: true,
    value: function fromHex(hex: string): Uint8Array {
      const out = new Uint8Array(hex.length >> 1);
      for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    },
  });
}

if (typeof (Math as unknown as { sumPrecise?: unknown }).sumPrecise !== 'function') {
  Object.defineProperty(Math, 'sumPrecise', {
    configurable: true,
    writable: true,
    // Neumaier compensated summation - the accuracy this proposal exists for.
    value: function sumPrecise(values: Iterable<number>): number {
      let sum = 0;
      let compensation = 0;
      for (const value of values) {
        const t = sum + value;
        compensation += Math.abs(sum) >= Math.abs(value) ? sum - t + value : value - t + sum;
        sum = t;
      }
      return sum + compensation;
    },
  });
}
