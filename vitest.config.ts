import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { ADMIN_PASSWORD: "correct horse battery staple", APP_SECRET: "0".repeat(63) + "1" },
      },
    }),
  ],
});
