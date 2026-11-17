# Podcast Proxy

Private RSS feeds of the podcasts you subscribe to, for Apple Podcasts or any other podcast app.
It runs on your own Cloudflare account, usually on the free plan.

Some publishers put their subscriber podcasts only in their own apps or on their websites. Podcast
Proxy signs in to your subscription, checks for new episodes every 30 minutes, and gives you a
private feed address for each show. Paste that address into Apple Podcasts with **Follow a Show by URL**.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/federicoodorizzi/podcast-proxy)

## Supported publishers

| Publisher | What you need | Shows |
| --- | --- | --- |
| [Internazionale](https://www.internazionale.it/podcast) | A digital subscription | Every show on internazionale.it/podcast, including the subscriber-only ones such as *A voce* |

Il Post is next. Adding a publisher is one file: see [Adding a publisher](#adding-a-publisher).

## How it works

- **Feeds carry no audio.** Each episode in a feed links to the publisher's own audio file, which
  your podcast app downloads directly. The Worker only serves the feed (a small XML file), so it
  stays fast and free.
- **Every 30 minutes**, a Cron Trigger signs in to each account (only when its session is about to
  expire), fetches each show you follow, and saves new episodes to a D1 database. Episodes stay in
  the feed even after the publisher's page stops listing them.
- **Each feed address holds a 256-bit secret token**, as in
  `https://podcasts.example.com/feed/<token>/a-voce.xml`. Apple Podcasts can't send a password
  with a feed, so this token is what keeps the feed private. Anyone who has the address can
  listen, so keep it to yourself. If it leaks, choose **New address** and the old one stops
  working at once.
- Every feed is marked `<itunes:block>Yes</itunes:block>`, so it never appears in Apple's public
  directory.

## Security

- **Publisher credentials** are encrypted with AES-256-GCM before they go into D1. Each one is
  bound to its own row, so a copied ciphertext won't decrypt anywhere else. The key is derived
  from `APP_SECRET`, a Worker secret that the first deploy generates and Cloudflare never shows
  again. Someone who could read your database would see only ciphertext.
- **The admin pages** ask for `ADMIN_PASSWORD`. They use a signed, `HttpOnly`, `SameSite=Strict`
  cookie, reject any POST that comes from another origin, and stop accepting passwords after 10
  wrong attempts in 15 minutes. Changing `ADMIN_PASSWORD` signs everyone out.
- **Feed tokens are stored as SHA-256 hashes** for lookup. An encrypted copy is kept only so the
  admin page can show you the address again.
- **Logs never include a token.** Cloudflare's invocation logs record every request URL, so this
  Worker turns them off (`observability.logs.invocation_logs: false`). Its own log lines never
  contain a token.
- Personal use only. Most subscriptions, Internazionale's included, allow personal use only and no
  redistribution. Don't share your feeds.

## Deploy

### With the button

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repository to your GitHub or
   GitLab account, creates the Worker and its D1 database, and asks for an **admin password**.
2. Once it has deployed, open the Worker's address (`https://podcast-proxy.<you>.workers.dev`) and
   sign in with that password.
3. Choose **Add an account → Internazionale**, enter your subscriber email and password, tick the
   shows you want, and choose **Make feeds**.
4. Copy a feed address. In Apple Podcasts: **Library → ⋯ → Follow a Show by URL** (on a Mac:
   **File → Follow a Show by URL**).

Every later push to your copy deploys it again. The build runs `pnpm run deploy`
([`scripts/deploy.ts`](scripts/deploy.ts)), which creates `APP_SECRET` on the first deploy and
leaves it alone afterwards.

> The button needs a public repository. To deploy a private copy, use the Cloudflare dashboard's
> **Workers & Pages → Create → Import a repository** with `pnpm run deploy` as the deploy command,
> or deploy from your own machine as below.

### From your machine

```sh
pnpm install
pnpm exec wrangler login
ADMIN_PASSWORD='choose-a-long-one' pnpm run deploy
```

If you leave out `ADMIN_PASSWORD`, the script generates one and prints it once.

### A custom domain

In the dashboard, open the Worker's **Settings → Domains & Routes → Add → Custom domain**, and
enter a hostname on a zone in your account, such as `podcasts.example.com`. Feed addresses follow
whichever address you use to open the admin pages.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars   # then fill in ADMIN_PASSWORD and APP_SECRET (openssl rand -hex 32)
pnpm dev                         # http://localhost:8787
pnpm check                       # typecheck, tests, and a dry-run build
```

The tests run inside workerd with a local D1, and use a made-up publisher
([`test/fixtures.ts`](test/fixtures.ts)), so they need no account and never contact a real site.

## Adding a publisher

1. Write `src/providers/<publisher>.ts`, exporting a `Provider` ([`src/providers/types.ts`](src/providers/types.ts)):
   - `credentialFields`: what the account form asks for.
   - `login(credentials, http)`: signs in and returns a session (opaque data and an expiry).
     It throws `CredentialsError` when the publisher turns the credentials down.
   - `listShows(http)`: the shows to offer in the picker.
   - `fetchShow(slug, session, http)`: the show and its newest episodes. It throws
     `SessionExpiredError` when the session no longer unlocks them, and the Worker then signs in
     again and retries once.
2. Add it to `providers` in [`src/providers/index.ts`](src/providers/index.ts).
3. Add tests with a made-up page or API response.

Use the `http` you're given rather than `fetch`. It sends a normal browser User-Agent, applies a
timeout, and lets the tests swap the publisher out.

## Costs

The free Workers plan covers this: one feed fetch per show every 30 minutes, plus whatever your
podcast apps request. A D1 database on the free plan holds up to 500 MB, which is years of episodes.
