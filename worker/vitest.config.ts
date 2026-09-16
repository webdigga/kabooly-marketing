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
          EMAIL_FROM: "test@example.com",
          FOUNDER_EMAIL: "founder@example.com",
          ANTHROPIC_API_KEY: "test-anthropic-key",
          GEMINI_API_KEY: "test-gemini-key",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**"],
      reporter: ["text", "html"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
