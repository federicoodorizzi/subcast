# Podcast Proxy

A Cloudflare Worker that turns subscriber podcasts into private RSS feeds. See README.md.

- Layout: `src/providers/` (one file per publisher, the `Provider` interface in `types.ts`),
  `src/db/` (schema, which the Worker applies itself, and `Store`, which holds every SQL statement),
  `src/refresh.ts` (cron), `src/feed.ts` (RSS), `src/web/` (admin pages, Hono JSX), `scripts/deploy.ts`.
- Schema changes: append a migration to `MIGRATIONS` in `src/db/schema.ts`; never edit one that has shipped.
- Never log or commit a feed token, publisher credential, session token or keyed audio URL. Test
  fixtures are made up (`test/fixtures.ts`); don't paste real publisher pages into the repo.
- Providers must use the `http` they're given, never `fetch` directly.
- Run `pnpm check` (typecheck, tests, dry-run build) before committing.
