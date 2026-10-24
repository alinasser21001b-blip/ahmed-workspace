import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Test-only values. Production secrets are generated in the deploy workflow.
          bindings: { TEST_MIGRATIONS: migrations, BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz", PUSH_TEST_HOSTS: "push.test" },
        },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
  };
});
