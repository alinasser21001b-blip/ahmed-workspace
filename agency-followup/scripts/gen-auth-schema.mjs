import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";
const options = {
  database: new DatabaseSync(":memory:"),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [username()],
  rateLimit: { enabled: true, storage: "database" },
  secret: "x".repeat(40),
};
const { compileMigrations } = await getMigrations(options);
console.log(await compileMigrations());
