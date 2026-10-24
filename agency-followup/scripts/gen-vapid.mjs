// Generate a VAPID key pair for Web Push (P-256).
//   node scripts/gen-vapid.mjs public   -> base64url public key (raw, 65 bytes)
//   node scripts/gen-vapid.mjs private  -> base64url private key (d)
// Run it once and pipe each value straight into `wrangler secret put`; the
// deploy workflow does this without printing the private key.
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.env.VAPID_TMP ?? ".vapid.tmp.json";
let pair;
if (existsSync(file)) pair = JSON.parse(readFileSync(file, "utf8"));
else {
  const k = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", k.publicKey));
  const jwk = await webcrypto.subtle.exportKey("jwk", k.privateKey);
  pair = { publicKey: raw.toString("base64url"), privateKey: jwk.d };
  writeFileSync(file, JSON.stringify(pair), { mode: 0o600 });
}
process.stdout.write(process.argv[2] === "private" ? pair.privateKey : pair.publicKey);
