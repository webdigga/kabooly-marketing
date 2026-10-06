import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = new URL("./migrations", import.meta.url).pathname;
const migrations = await readD1Migrations(migrationsPath);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: "test-secret-for-vitest-only-0123456789",
          BETTER_AUTH_URL: "http://localhost",
          GOOGLE_CLIENT_ID: "test-google-client-id",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
          // 32 bytes, base64url, for the Google refresh token encryption.
          GOOGLE_TOKEN_KEY: "dGVzdC1nb29nbGUtdG9rZW4ta2V5LTAxMjM0NTY3ODk",
          EMAIL_FROM: "test@example.com",
          FOUNDER_LOGIN_EMAIL: "founder@example.com",
          INTERNAL_API_SECRET: "test-internal-secret",
          STRIPE_WEBHOOK_SECRET: "whsec_test_marketing",
          ANTHROPIC_API_KEY: "test-anthropic-key",
          GEMINI_API_KEY: "test-gemini-key",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    // The tests that cut platform images run the Images binding over real
    // pixels, and the platform sizes grew to 1440x1800, so a few of them pass
    // 5 seconds once istanbul is instrumenting the worker.
    testTimeout: 20_000,
    coverage: {
      provider: "istanbul",
      include: ["src/**"],
      reporter: ["text", "html"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
