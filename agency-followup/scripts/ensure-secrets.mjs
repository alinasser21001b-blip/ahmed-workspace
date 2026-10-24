// Make sure a deployed Worker has its secrets, generating any that are
// missing. Values go straight from memory to `wrangler secret bulk` through a
// temporary file that is deleted at once; nothing is printed.
//   node scripts/ensure-secrets.mjs <worker-name>
import { execFileSync } from "node:child_process";
import { randomBytes, webcrypto } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const name = process.argv[2];
if (!name) throw new Error("worker name required");
const run = (args, opts = {}) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

let existing = [];
try {
  existing = JSON.parse(run(["secret", "list", "--name", name, "--format", "json"])).map((s) => s.name);
} catch {
  existing = [];
}
const missing = {};
if (!existing.includes("BETTER_AUTH_SECRET")) missing.BETTER_AUTH_SECRET = randomBytes(32).toString("base64url");
if (!existing.includes("VAPID_PUBLIC_KEY") || !existing.includes("VAPID_PRIVATE_KEY")) {
  const k = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  missing.VAPID_PUBLIC_KEY = Buffer.from(await webcrypto.subtle.exportKey("raw", k.publicKey)).toString("base64url");
  missing.VAPID_PRIVATE_KEY = (await webcrypto.subtle.exportKey("jwk", k.privateKey)).d;
}
const names = Object.keys(missing);
if (!names.length) {
  console.log(`${name}: all secrets already set (${existing.join(", ")})`);
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), "sec-"));
const file = join(dir, "s.json");
try {
  writeFileSync(file, JSON.stringify(missing), { mode: 0o600 });
  run(["secret", "bulk", file, "--name", name]);
  console.log(`${name}: set ${names.join(", ")}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
