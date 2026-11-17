import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// An optional, untracked wrangler.local.json overrides wrangler.jsonc for your own deployment: a
// Worker or database name of your own, or a custom domain. Its top-level fields replace the ones
// in wrangler.jsonc. See README.md, "Deploy" → "Your own settings".
const localConfigPath = fileURLToPath(new URL("./wrangler.local.json", import.meta.url));
const localConfig = existsSync(localConfigPath) ? JSON.parse(readFileSync(localConfigPath, "utf8")) : undefined;

// One build for both halves: the admin app (app/, React + shadcn/ui) becomes static assets, and the
// Worker (src/) serves them beside /api and /feed.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(localConfig ? { config: (worker) => void Object.assign(worker, localConfig) } : {})],
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) } },
});
