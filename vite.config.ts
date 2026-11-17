import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// One build for both halves: the admin app (app/, React + shadcn/ui) becomes static assets, and the
// Worker (src/) serves them beside /api and /feed.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) } },
});
