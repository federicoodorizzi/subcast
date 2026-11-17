# Subcast

A Cloudflare Worker that turns subscriber podcasts into private RSS feeds. See README.md.

- Two halves, one Vite build: `src/` is the Worker (feeds, `/api` JSON, cron), `app/` is the admin
  app (React + shadcn/ui, `app/components/ui/` comes from the shadcn CLI, so restyle through tokens in
  `app/index.css` or wrappers in `app/components/`, not by editing those files). The API's JSON types
  live in `src/api-types.ts`, shared by both. Design for phones first: 44px tap targets, safe areas.
- Layout: `src/providers/` (one file per publisher, the `Provider` interface in `types.ts`),
  `src/db/` (schema, which the Worker applies itself, and `Store`, which holds every SQL statement),
  `src/refresh.ts` (cron), `src/feed.ts` (RSS), `src/web/` (admin pages, Hono JSX), `scripts/deploy.ts`.
- Schema changes: append a migration to `MIGRATIONS` in `src/db/schema.ts`; never edit one that has shipped.
- Never log or commit a feed token, publisher credential, session token or keyed audio URL. Test
  fixtures are made up (`test/fixtures.ts`); don't paste real publisher pages into the repo.
- Providers must use the `http` they're given, never `fetch` directly.
- Run `pnpm check` (typecheck, tests, dry-run build) before committing.
