import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { ensureSchema } from "../db/schema";
import { Store } from "../db/store";
import { missingSetup, type Env } from "../env";
import { renderFeed } from "../feed";
import { getProvider, providers, publisherFetch } from "../providers";
import { CredentialsError, type Http } from "../providers/types";
import { refreshFeed } from "../refresh";
import { JS, CSS } from "./assets";
import { checkPassword, endSession, isSignedIn, startSession } from "./auth";
import { AccountForm, Dashboard, ErrorPage, Login, SetupNeeded, ShowPicker } from "./views";

type AppEnv = { Bindings: Env; Variables: { store: Store } };
type C = Context<AppEnv>;

const THROTTLE_WINDOW_MS = 15 * 60_000;

/** The Worker's HTTP side. `http` is how it reaches publishers, which tests replace. */
export function createApp(http: Http = publisherFetch) {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.res.headers.get("Content-Type")?.startsWith("text/html")) {
      c.header("Content-Security-Policy", "default-src 'none'; style-src 'self'; script-src 'self'; img-src https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      c.header("Cache-Control", "no-store");
    }
  });

  app.get("/app.css", (c) => c.body(CSS, 200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" }));
  app.get("/app.js", (c) => c.body(JS, 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" }));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
  app.get("/healthz", (c) => c.text("ok"));

  // Nothing below works without the secrets; say which are missing rather than fail obscurely.
  app.use(async (c, next) => {
    const missing = missingSetup(c.env);
    if (missing.length) {
      if (c.req.path.startsWith("/feed/")) return c.text("Not found", 404);
      return c.html(<SetupNeeded missing={missing} />, 503);
    }
    await ensureSchema(c.env.DB);
    c.set("store", new Store(c.env.DB, c.env.APP_SECRET!));
    await next();
  });

  // The feeds themselves: the token in the path is the only key, so a wrong one looks like nothing's there.
  app.on(["GET", "HEAD"], "/feed/:token/:file", async (c) => {
    const store = c.get("store");
    const feed = await store.feedByToken(c.req.param("token"));
    if (!feed) return c.text("Not found", 404);
    const episodes = await store.episodes(feed.id);
    const etag = `W/"${feed.id}-${feed.last_refreshed_at ?? 0}-${episodes.length}-${episodes[0]?.guid ?? ""}"`;
    const headers = {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "private, max-age=600",
      ETag: etag,
      "X-Robots-Tag": "noindex, nofollow",
    };
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304, headers);
    const selfUrl = new URL(c.req.url);
    selfUrl.search = "";
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(renderFeed(feed, episodes, selfUrl.toString()), 200, headers);
  });

  // The admin pages. Every POST must come from this origin, on top of the SameSite=Strict cookie.
  app.use(csrf());

  app.get("/login", async (c) => ((await isSignedIn(c)) ? c.redirect("/") : c.html(<Login />)));

  app.post("/login", async (c) => {
    const store = c.get("store");
    const ip = c.req.header("CF-Connecting-IP") ?? "local";
    const buckets = [`ip:${ip}`, "all"];
    if ((await store.isThrottled(buckets[0]!, 10, THROTTLE_WINDOW_MS)) || (await store.isThrottled(buckets[1]!, 50, THROTTLE_WINDOW_MS))) {
      return c.html(<Login error="Too many wrong passwords. Try again in 15 minutes." />, 429);
    }
    const form = await c.req.formData();
    if (!(await checkPassword(c.env, String(form.get("password") ?? "")))) {
      for (const b of buckets) await store.recordFailure(b, THROTTLE_WINDOW_MS);
      return c.html(<Login error="That's not the password." />, 401);
    }
    await store.clearFailures(buckets[0]!);
    await startSession(c);
    return c.redirect("/", 303);
  });

  app.post("/logout", (c) => {
    endSession(c);
    return c.redirect("/login", 303);
  });

  app.use(async (c, next) => {
    if (!(await isSignedIn(c))) return c.req.method === "GET" ? c.redirect("/login") : c.text("Sign in first", 401);
    await next();
  });

  app.get("/", async (c) => {
    const store = c.get("store");
    const [accounts, feeds, counts] = await Promise.all([store.listAccounts(), store.listFeeds(), store.episodeCounts()]);
    const origin = new URL(c.req.url).origin;
    const rows = await Promise.all(
      feeds.map(async (feed) => ({ feed, url: `${origin}/feed/${await store.feedToken(feed)}/${feed.show_slug}.xml`, episodes: counts.get(feed.id) ?? 0 })),
    );
    return c.html(<Dashboard accounts={accounts} feeds={rows} providers={providers} notice={c.req.query("notice")} />);
  });

  app.get("/accounts/new", (c) => {
    const provider = getProvider(c.req.query("provider") ?? "");
    if (!provider) return notFound(c);
    return c.html(<AccountForm provider={provider} action={`/accounts?provider=${provider.id}`} />);
  });

  app.post("/accounts", async (c) => {
    const provider = getProvider(c.req.query("provider") ?? "");
    if (!provider) return notFound(c);
    const { label, credentials } = await readAccountForm(c, provider.credentialFields.map((f) => f.name));
    try {
      const session = await provider.login(credentials, http);
      const id = await c.get("store").createAccount(provider.id, label || provider.name, credentials, session);
      return c.redirect(`/accounts/${id}/shows`, 303);
    } catch (err) {
      return c.html(<AccountForm provider={provider} action={`/accounts?provider=${provider.id}`} label={label} error={signInError(err)} />, 400);
    }
  });

  app.get("/accounts/:id/edit", async (c) => {
    const account = await c.get("store").getAccount(Number(c.req.param("id")));
    const provider = account && getProvider(account.provider);
    if (!account || !provider) return notFound(c);
    return c.html(<AccountForm provider={provider} action={`/accounts/${account.id}/edit`} label={account.label} editing />);
  });

  app.post("/accounts/:id/edit", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    const provider = account && getProvider(account.provider);
    if (!account || !provider) return notFound(c);
    const { label, credentials } = await readAccountForm(c, provider.credentialFields.map((f) => f.name));
    try {
      const session = await provider.login(credentials, http);
      await store.updateCredentials(account.id, credentials, session);
      if (label) await c.env.DB.prepare("UPDATE accounts SET label = ? WHERE id = ?").bind(label, account.id).run();
      return c.redirect("/?notice=Credentials+updated", 303);
    } catch (err) {
      return c.html(<AccountForm provider={provider} action={`/accounts/${account.id}/edit`} label={label} error={signInError(err)} editing />, 400);
    }
  });

  app.post("/accounts/:id/delete", async (c) => {
    await c.get("store").deleteAccount(Number(c.req.param("id")));
    return c.redirect("/?notice=Account+deleted", 303);
  });

  app.get("/accounts/:id/shows", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    const provider = account && getProvider(account.provider);
    if (!account || !provider) return notFound(c);
    const followed = new Set((await store.listFeeds()).filter((f) => f.account_id === account.id).map((f) => f.show_slug));
    try {
      return c.html(<ShowPicker account={account} provider={provider} shows={await provider.listShows(http)} followed={followed} />);
    } catch (err) {
      return c.html(<ShowPicker account={account} provider={provider} shows={[]} followed={followed} error={`Couldn't list the shows: ${String(err)}`} />, 502);
    }
  });

  app.post("/accounts/:id/shows", async (c) => {
    const store = c.get("store");
    const account = await store.getAccount(Number(c.req.param("id")));
    if (!account) return notFound(c);
    const picked = (await c.req.formData()).getAll("show").map(String).slice(0, 25);
    let failed = 0;
    for (const value of picked) {
      const [slug, title] = value.split("\n");
      if (!slug || !/^[a-z0-9-]{1,100}$/.test(slug)) continue;
      const feedId = await store.createFeed(account.id, slug, title?.slice(0, 200) || slug);
      const result = await refreshFeed(store, (await store.getAccount(account.id))!, (await store.getFeed(feedId))!, http);
      if (result.error) failed++;
    }
    const notice = failed ? `Feeds made; ${failed} couldn't be checked yet — see below` : "Feeds made";
    return c.redirect(`/?notice=${encodeURIComponent(notice)}`, 303);
  });

  app.post("/feeds/:id/:action{refresh|toggle|rotate|delete}", async (c) => {
    const store = c.get("store");
    const feed = await store.getFeed(Number(c.req.param("id")));
    if (!feed) return notFound(c);
    let notice = "";
    switch (c.req.param("action")) {
      case "refresh": {
        const result = await refreshFeed(store, (await store.getAccount(feed.account_id))!, feed, http);
        notice = result.error ? `${feed.title}: check failed` : `${result.title}: ${result.newEpisodes} new episode${result.newEpisodes === 1 ? "" : "s"}`;
        break;
      }
      case "toggle":
        await store.setFeedEnabled(feed.id, !feed.enabled);
        notice = `${feed.title} ${feed.enabled ? "paused" : "resumed"}`;
        break;
      case "rotate":
        await store.rotateToken(feed.id);
        notice = `${feed.title} has a new address. Follow the show again with it.`;
        break;
      case "delete":
        await store.deleteFeed(feed.id);
        notice = `${feed.title} deleted`;
        break;
    }
    return c.redirect(`/?notice=${encodeURIComponent(notice)}`, 303);
  });

  app.notFound((c) => (c.req.path.startsWith("/feed/") ? c.text("Not found", 404) : notFound(c)));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`request failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    if (c.req.path.startsWith("/feed/")) return c.text("Internal error", 500);
    return c.html(<ErrorPage status={500} message="The Worker hit an error. Its logs in the Cloudflare dashboard say more." />, 500);
  });

  return app;
}

function notFound(c: C) {
  return c.html(<ErrorPage status={404} message="There's nothing here." />, 404);
}

async function readAccountForm(c: C, fields: string[]) {
  const form = await c.req.formData();
  const credentials: Record<string, string> = {};
  for (const name of fields) credentials[name] = String(form.get(`cred_${name}`) ?? "");
  return { label: String(form.get("label") ?? "").trim().slice(0, 80), credentials };
}

function signInError(err: unknown): string {
  if (err instanceof CredentialsError) return err.message;
  console.error(`sign-in failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  return "Couldn't reach the publisher to sign in. Try again in a minute.";
}
