// Random identifiers, token hashing and PBKDF2 password hashing on Web Crypto.
// PBKDF2-SHA256 is a standard KDF implemented natively by the Workers runtime;
// it replaces Better Auth's default scrypt, whose pure-JS cost can exceed a
// Worker's CPU budget. The iteration count is stored inside every hash so it
// can be raised later without invalidating existing passwords.

const enc = new TextEncoder();

export function randomId(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "");
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return b64url(new Uint8Array(digest));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Workers cap PBKDF2 at 100000 iterations.
export const MAX_PBKDF2_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const it = Math.min(Math.max(iterations, 10_000), MAX_PBKDF2_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, it);
  return `pbkdf2_sha256$${it}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const it = Number(parts[1]);
  if (!Number.isInteger(it) || it < 1 || it > MAX_PBKDF2_ITERATIONS) return false;
  const expected = fromB64url(parts[3]);
  const actual = await derive(password, fromB64url(parts[2]), it);
  return timingSafeEqual(actual, expected);
}
