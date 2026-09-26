import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          PUBLIC_BASE_URL: "https://onepager.test",
          GITHUB_CLIENT_ID: "gh-id",
          GITHUB_CLIENT_SECRET: "gh-secret",
          GOOGLE_CLIENT_ID: "g-id",
          GOOGLE_CLIENT_SECRET: "g-secret",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
