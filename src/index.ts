import { ensureSchema } from "./db/schema";
import { Store } from "./db/store";
import { missingSetup, type Env } from "./env";
import { refreshAll } from "./refresh";
import { createApp } from "./web/app";

const app = createApp();

export default {
  fetch: app.fetch,

  async scheduled(_controller, env, ctx) {
    const missing = missingSetup(env);
    if (missing.length) {
      console.warn(`refresh skipped: missing ${missing.join(", ")}`);
      return;
    }
    ctx.waitUntil(
      (async () => {
        await ensureSchema(env.DB);
        const results = await refreshAll(new Store(env.DB, env.APP_SECRET!));
        const fresh = results.reduce((n, r) => n + r.newEpisodes, 0);
        const failed = results.filter((r) => r.error).length;
        console.log(`refresh: ${results.length} feed(s), ${fresh} new episode(s), ${failed} failed`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
