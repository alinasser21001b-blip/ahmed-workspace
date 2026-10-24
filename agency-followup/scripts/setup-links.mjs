// Create one-time setup links for team members.
//   node scripts/setup-links.mjs --origin https://agency-followup.example.workers.dev --sql out.sql --links links.txt [--users mohammed,ammar]
// Writes the SQL (token hashes only) to --sql and the raw links to --links.
// Apply the SQL with: npx wrangler d1 execute agency-followup-db --remote --file out.sql
// Keep the links file private and delete it after handing each link to its owner.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const origin = args.origin;
if (!origin || !args.sql || !args.links) {
  console.error("usage: --origin <url> --sql <file> --links <file> [--users a,b] [--hours 72]");
  process.exit(1);
}
const users = (args.users ?? "mohammed,ammar,sama,hussein").split(",");
const hours = Number(args.hours ?? 72);
const now = new Date();
const expires = new Date(now.getTime() + hours * 3600_000).toISOString();
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sql = [];
const links = [];
for (const u of users) {
  const uid = `u_${u}`;
  const token = b64url(randomBytes(32));
  const hash = b64url(createHash("sha256").update(token).digest());
  sql.push(`update setup_tokens set revoked_at = '${now.toISOString()}' where user_id = '${uid}' and used_at is null and revoked_at is null;`);
  sql.push(`insert into setup_tokens (id, user_id, token_hash, expires_at, created_by, created_at) values ('st_${randomUUID().replace(/-/g, "")}', '${uid}', '${hash}', '${expires}', null, '${now.toISOString()}');`);
  links.push(`${u}\t${origin.replace(/\/$/, "")}/setup#${token}`);
}
writeFileSync(args.sql, sql.join("\n") + "\n");
writeFileSync(args.links, `# One-time setup links, valid until ${expires} (UTC). Private: give each link only to its owner.\n` + links.join("\n") + "\n", { mode: 0o600 });
console.log(`wrote ${users.length} token hashes to ${args.sql} and the links to ${args.links}`);
