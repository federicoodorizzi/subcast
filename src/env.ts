export interface Env {
  DB: D1Database;
  /** The password the admin pages ask for. Set by the Deploy to Cloudflare form, or `wrangler secret put`. */
  ADMIN_PASSWORD?: string;
  /**
   * 32 random bytes, hex. Every key the Worker uses (credential encryption, session signing) is derived
   * from it. `pnpm run deploy` makes it on the first deploy; changing it makes stored credentials unreadable.
   */
  APP_SECRET?: string;
}

/** What's missing for the Worker to run, in words for the setup page; empty when it's ready. */
export function missingSetup(env: Env): string[] {
  const missing: string[] = [];
  if (!env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!env.APP_SECRET || !/^[0-9a-f]{64}$/.test(env.APP_SECRET)) missing.push("APP_SECRET");
  return missing;
}
