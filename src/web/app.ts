import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AccountInfo, ApiError, EpisodeInfo, FeedInfo, ProviderInfo, RefreshInfo, SessionInfo, ShowChoice, State } from "../api-types";
import { ensureSchema } from "../db/schema";
import { Store, type AccountRow, type FeedRow } from "../db/store";
import { missingSetup, type Env } from "../env";
import { serveArtwork } from "../art";
import { renderFeed } from "../feed";
import { getProvider, providers, publisherFetch } from "../providers";
import { CredentialsError, type Http, type Provider } from "../providers/types";
import { refreshFeed } from "../refresh";
import { checkPassword, endSession, isSignedIn, startSession } from "./auth";

type AppEnv = { Bindings: Env; Variables: { store: Store } };
type C = Context<AppEnv>;

const THROTTLE_WINDOW_MS = 15 * 60_000;
/** A show's slug as publishers write them: lowercase letters, digits, dashes, underscores. */
const SLUG = /^[a-z0-9_-]{1,100}$/;

/**
 * The Worker's HTTP side: the feeds at /feed, and the JSON API at /api that the admin app (app/) uses.
 * Everything else is the app's static files. `http` is how it reaches publishers, which tests replace.
 */
export function createApp(http: Http = publisherFetch) {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/api/session", async (c) => {
    const missing = missingSetup(c.env);
    return c.json<SessionInfo>({ setupMissing: missing, signedIn: missing.length === 0 && (await isSignedIn(c)) });
  });

  // Nothing below works without the secrets.
  app.use(async (c, next) => {
    if (missingSetup(c.env).length) return c.req.path.startsWith("/feed/") ? c.text("Not found", 404) : fail(c, 503, "The Worker isn't set up yet");
    await ensureSchema(c.env.DB);
    c.set("store", new Store(c.env.DB, c.env.APP_SECRET!));
    await next();
  });

  // The feeds: the token in the path is the only key, so a wrong one looks like nothing's there.
  app.on(["GET", "HEAD"], "/feed/:token/:file", async (c) => {
    const store = c.get("store");
    const feed = await store.feedByToken(c.req.param("token"));
    if (!feed) return c.text("Not found", 404);
    const episodes = await store.episodes(feed.id);
    const etag = `W/"${feed.id}-${feed.last_refreshed_at ?? 0}-${episodes.length}-${episodes[0]?.guid ?? ""}"`;
    const headers = { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "private, max-age=600", ETag: etag, "X-Robots-Tag": "noindex, nofollow" };
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304, headers);
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    const selfUrl = new URL(c.req.url);
    selfUrl.search = "";
    const base = `${selfUrl.origin}/feed/${c.req.param("token")}`;
    return c.body(renderFeed(feed, episodes, selfUrl.toString(), base), 200, headers);
  });

  // A feed's artwork, behind the same token: art/show.jpg, or art/<episode guid>.jpg.
  app.get("/feed/:token/art/:name", async (c) => {
    const store = c.get("store");
    const feed = await store.feedByToken(c.req.param("token"));
    if (!feed) return c.text("Not found", 404);
    const name = decodeURIComponent(c.req.param("name")).replace(/\.jpg$/, "");
    const source = name === "show" ? feed.image_url : ((await store.episode(feed.id, name))?.image_url ?? feed.image_url);
    if (!source || !/^https:\/\//.test(source)) return c.text("Not found", 404);
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      // No ExecutionContext outside a real request (tests); the cache write is awaited instead.
    }
    return serveArtwork(source, c.env.IMAGES, http, ctx);
  });

  // Every request that changes something must come from the app itself. Browsers always send Origin
  // with these, and the JSON body forces a preflight that no other origin passes, on top of the
  // SameSite=Strict cookie.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (c.req.header("Origin") !== new URL(c.req.url).origin) return fail(c, 403, "Cross-origin request refused");
      const type = c.req.header("Content-Type");
      if (type && !type.startsWith("application/json")) return fail(c, 415, "Send JSON");
    }
    await next();
  });

  app.post("/api/login", async (c) => {
    const store = c.get("store");
    const ip = c.req.header("CF-Connecting-IP") ?? "local";
    const buckets = [`ip:${ip}`, "all"] as const;
    if ((await store.isThrottled(buckets[0], 10, THROTTLE_WINDOW_MS)) || (await store.isThrottled(buckets[1], 50, THROTTLE_WINDOW_MS))) {
      return fail(c, 429, "Too many wrong passwords. Try again in 15 minutes.");
    }
    const { password } = await body<{ password?: string }>(c);
    if (!(await checkPassword(c.env, String(password ?? "")))) {
      for (const b of buckets) await store.recordFailure(b, THROTTLE_WINDOW_MS);
      return fail(c, 401, "That's not the password.");
    }
    await store.clearFailures(buckets[0]);
    await startSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/logout", (c) => {
    endSession(c);
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    if (!(await isSignedIn(c))) return fail(c, 401, "Sign in first");
    await next();
  });

  app.get("/api/state", async (c) => {
    const store = c.get("store");
    const [accounts, feeds, stats] = await Promise.all([store.listAccounts(), store.listFeeds(), store.episodeStats()]);
    const origin = new URL(c.req.url).origin;
    return c.json<State>({
      providers: providers.map(providerInfo),
      accounts: accounts.map(accountInfo),
      feeds: await Promise.all(feeds.map(async (f) => feedInfo(f, `${origin}/feed/${await store.feedToken(f)}/${f.show_slug}.xml`, stats.get(f.id)))),
    });
  });

  // Accounts

  app.post("/api/accounts", async (c) => {
    const { provider: providerId, label, credentials } = await body<{ provider?: string; label?: string; credentials?: Record<string, unknown> }>(c);
    const provider = getProvider(String(providerId ?? ""));
    if (!provider) return fail(c, 404, "No such publisher");
    const creds = credentialsFor(provider, credentials);
    try {
      const session = await provider.login(creds, http);
      const id = await c.get("store").createAccount(provider.id, cleanLabel(label) || provider.name, creds, session);
      return c.json(accountInfo((await c.get("store").getAccount(id))!), 201);
    } catch (err) {
      return signInFailure(c, err);
    }
  });

  app.patch("/api/accounts/:id", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    const provider = account && getProvider(account.provider);
    if (!account || !provider) return fail(c, 404, "No such account");
    const { label, credentials } = await body<{ label?: string; credentials?: Record<string, unknown> }>(c);
    if (credentials) {
      const creds = credentialsFor(provider, credentials);
      try {
        await store.updateCredentials(account.id, creds, await provider.login(creds, http));
      } catch (err) {
        return signInFailure(c, err);
      }
    }
    if (cleanLabel(label)) await store.setAccountLabel(account.id, cleanLabel(label));
    return c.json(accountInfo((await store.getAccount(account.id))!));
  });

  app.delete("/api/accounts/:id", async (c) => {
    await c.get("store").deleteAccount(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.get("/api/accounts/:id/shows", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    const provider = account && getProvider(account.provider);
    if (!account || !provider) return fail(c, 404, "No such account");
    const followed = new Map((await store.listFeeds()).filter((f) => f.account_id === account.id).map((f) => [f.show_slug, f.id]));
    try {
      const shows = await provider.listShows(http);
      return c.json<ShowChoice[]>(shows.map((s) => ({ slug: s.slug, title: s.title, imageUrl: s.imageUrl ?? null, subscriberOnly: !!s.subscriberOnly, feedId: followed.get(s.slug) ?? null })));
    } catch (err) {
      return fail(c, 502, `Couldn't list ${provider.name}'s shows: ${errorText(err)}`);
    }
  });

  /** Makes a feed for one show and checks it straight away; the app calls this once per ticked show. */
  app.post("/api/accounts/:id/feeds", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    if (!account) return fail(c, 404, "No such account");
    const { slug, title } = await body<{ slug?: string; title?: string }>(c);
    if (!slug || !SLUG.test(slug)) return fail(c, 400, "That's not a show");
    const feedId = await store.createFeed(account.id, slug, String(title ?? "").slice(0, 200) || slug);
    const result = await refreshFeed(store, account, (await store.getFeed(feedId))!, http);
    return c.json<RefreshInfo>(result, 201);
  });

  // Feeds

  app.get("/api/feeds/:id/episodes", async (c) => {
    const episodes = await c.get("store").episodes(Number(c.req.param("id")), 20);
    return c.json<EpisodeInfo[]>(episodes.map((e) => ({ guid: e.guid, title: e.title, publishedAt: e.published_at, durationSeconds: e.duration_seconds, link: e.link })));
  });

  app.post("/api/feeds/:id/refresh", async (c) => {
    const store = c.get("store");
    const feed = await store.getFeed(Number(c.req.param("id")));
    const account = feed && (await store.getAccount(feed.account_id));
    if (!feed || !account) return fail(c, 404, "No such feed");
    return c.json<RefreshInfo>(await refreshFeed(store, account, feed, http));
  });

  app.patch("/api/feeds/:id", async (c) => {
    const store = c.get("store");
    const feed = await store.getFeed(Number(c.req.param("id")));
    if (!feed) return fail(c, 404, "No such feed");
    const { enabled } = await body<{ enabled?: boolean }>(c);
    if (typeof enabled === "boolean") await store.setFeedEnabled(feed.id, enabled);
    return c.json({ ok: true });
  });

  app.post("/api/feeds/:id/rotate", async (c) => {
    const store = c.get("store");
    const feed = await store.getFeed(Number(c.req.param("id")));
    if (!feed) return fail(c, 404, "No such feed");
    await store.rotateToken(feed.id);
    return c.json({ ok: true });
  });

  app.delete("/api/feeds/:id", async (c) => {
    await c.get("store").deleteFeed(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.all("/api/*", (c) => fail(c, 404, "No such endpoint"));
  app.notFound((c) => c.text("Not found", 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`request failed: ${errorText(err)}`);
    if (c.req.path.startsWith("/feed/")) return c.text("Internal error", 500);
    return fail(c, 500, "The Worker hit an error. Its logs in the Cloudflare dashboard say more.");
  });

  return app;
}

function fail(c: C, status: 400 | 401 | 403 | 404 | 415 | 429 | 500 | 502 | 503, error: string) {
  return c.json<ApiError>({ error }, status);
}

async function body<T>(c: C): Promise<Partial<T>> {
  try {
    const parsed = await c.req.json();
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

function credentialsFor(provider: Provider, given: Record<string, unknown> | undefined): Record<string, string> {
  const creds: Record<string, string> = {};
  for (const f of provider.credentialFields) creds[f.name] = String(given?.[f.name] ?? "");
  return creds;
}

const cleanLabel = (label: unknown) => String(label ?? "").trim().slice(0, 80);

function signInFailure(c: C, err: unknown) {
  if (err instanceof CredentialsError) return fail(c, 400, err.message);
  console.error(`sign-in failed: ${errorText(err)}`);
  return fail(c, 502, "Couldn't reach the publisher to sign in. Try again in a minute.");
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function providerInfo(p: Provider): ProviderInfo {
  return { id: p.id, name: p.name, homepage: p.homepage, credentialFields: p.credentialFields };
}

function accountInfo(a: AccountRow): AccountInfo {
  return { id: a.id, provider: a.provider, label: a.label, lastError: a.last_error, createdAt: a.created_at };
}

function feedInfo(f: FeedRow, url: string, stats: { count: number; latest: number | null } | undefined): FeedInfo {
  return {
    id: f.id,
    accountId: f.account_id,
    slug: f.show_slug,
    title: f.title,
    author: f.author,
    imageUrl: f.image_url,
    link: f.link,
    enabled: !!f.enabled,
    episodes: stats?.count ?? 0,
    latestEpisodeAt: stats?.latest ?? null,
    lastRefreshedAt: f.last_refreshed_at,
    lastError: f.last_error,
    url,
  };
}
