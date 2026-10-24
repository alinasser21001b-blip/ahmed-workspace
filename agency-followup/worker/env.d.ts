// Secrets are set with `wrangler secret put` (or the deploy workflow) and never live in wrangler.jsonc.
interface AppSecrets {
  BETTER_AUTH_SECRET: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Test-only: extra push hosts (host:port) accepted for subscriptions. Never set in production. */
  PUSH_TEST_HOSTS?: string;
}
interface Env extends AppSecrets {}
declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
