import { randomBytes, createHash } from 'node:crypto';

export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(9).toString('base64url');
  return `${prefix}_${time}${rand}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Saudi local time for a UTC instant. Riyadh has a fixed UTC+3 offset with no
 * daylight saving, but this still goes through the real timezone database via
 * Intl rather than hard-coding an offset.
 */
export function riyadhLocalTime(utcIso: string, timeZone = 'Asia/Riyadh'): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Invalid timestamp: ${utcIso}`);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+03:00`;
}

/** The Saudi-local calendar date a UTC instant falls on — the travel day. */
export function riyadhDate(utcIso: string, timeZone = 'Asia/Riyadh'): string {
  return riyadhLocalTime(utcIso, timeZone).slice(0, 10);
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly messageAr?: string;
  constructor(statusCode: number, message: string, messageAr?: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.messageAr = messageAr;
  }
}

export function badRequest(en: string, ar?: string): HttpError {
  return new HttpError(400, en, ar);
}
export function unauthorized(en = 'Not signed in', ar = 'غير مسجّل الدخول'): HttpError {
  return new HttpError(401, en, ar);
}
export function forbidden(en = 'Not allowed', ar = 'غير مسموح'): HttpError {
  return new HttpError(403, en, ar);
}
export function notFound(en = 'Not found', ar = 'غير موجود'): HttpError {
  return new HttpError(404, en, ar);
}
export function conflict(en: string, ar?: string): HttpError {
  return new HttpError(409, en, ar);
}

/** Parse an incoming minor-unit amount: accepts string digits only. */
export function parseMinor(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw badRequest(`${field} must be an integer amount in minor units`, `${field} يجب أن يكون رقمًا صحيحًا`);
}

export function optionalMinor(value: unknown, field: string): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  return parseMinor(value, field);
}

export function requireString(value: unknown, field: string, maxLen = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} is required`, `${field} مطلوب`);
  }
  if (value.length > maxLen) throw badRequest(`${field} is too long`);
  return value.trim();
}

export function optionalString(value: unknown, field: string, maxLen = 2000): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  if (value.length > maxLen) throw badRequest(`${field} is too long`);
  const t = value.trim();
  return t.length === 0 ? null : t;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T;
  throw badRequest(`${field} must be one of: ${options.join(', ')}`);
}

export function optionalOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): T | null {
  if (value === null || value === undefined || value === '') return null;
  return oneOf(value, options, field);
}

/** JSON.stringify that refuses bigint by accident — everything goes to wire types first. */
export function assertWireSafe(obj: unknown, context: string): void {
  JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'bigint') {
      throw new TypeError(`${context}: bigint reached the wire unserialised`);
    }
    return v as unknown;
  });
}
