import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { FeedInfo, ShowChoice, State } from "../src/api-types";
import type { Http } from "../src/providers/types";
import { createApp } from "../src/web/app";
import { fakeJwt, podcastIndex, showPage, type FakeEpisode } from "./fixtures";

const ORIGIN = "https://proxy.example.test";
const PASSWORD = env.ADMIN_PASSWORD;
const LOGIN = { provider: "internazionale", label: "Mine", credentials: { email: "me@example.test", password: "secret" } };

/** A pretend Internazionale: signs in one account, and hides subscriber keys from anyone without its token. */
function fakeInternazionale(episodes: FakeEpisode[]) {
  const calls: string[] = [];
  const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 7 * 86400, in_subscription: { is_subscribed: "true" } });
  const http: Http = async (url, init) => {
    calls.push(url);
    if (url === "https://api.internazionale.it/users/login/") {
      const body = JSON.parse(String(init?.body));
      return body.email === "me@example.test" && body.psw === "secret"
        ? Response.json({ response: "ok", info: { token } })
        : Response.json({ response: "ko", info: { message: "login failed" } }, { status: 401 });
    }
    if (url === "https://www.internazionale.it/podcast") return new Response(podcastIndex);
    if (url.startsWith("https://www.internazionale.it/podcast/")) {
      const signedIn = new Headers(init?.headers).get("Cookie") === `internaz_auth_tkn=${token}`;
      return new Response(showPage("A voce", episodes.map((e) => ({ ...e, keyed: e.keyed && signedIn }))));
    }
    return new Response("unexpected", { status: 500 });
  };
  return { http, calls };
}

/** A browser on the admin app: keeps the session cookie, and sends JSON from the app's own origin. */
class Browser {
  cookie = "";
  constructor(private app: ReturnType<typeof createApp>) {}

  async request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("Cookie", this.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("Content-Type", "application/json");
    }
    if (init.method && init.method !== "GET" && !headers.has("Origin")) headers.set("Origin", ORIGIN);
    const res = await this.app.fetch(new Request(ORIGIN + path, { ...init, headers, body, redirect: "manual" }), env);
    const set = res.headers.get("Set-Cookie");
    if (set) this.cookie = set.split(";")[0]!;
    return res;
  }

  post(path: string, json?: unknown, headers?: HeadersInit) {
    return this.request(path, { method: "POST", json, headers });
  }

  signIn() {
    return this.post("/api/login", { password: PASSWORD });
  }

  async state(): Promise<State> {
    return (await this.request("/api/state")).json();
  }
}

async function connected(fake: ReturnType<typeof fakeInternazionale>) {
  const browser = new Browser(createApp(fake.http));
  await browser.signIn();
  const account = (await (await browser.post("/api/accounts", LOGIN)).json()) as { id: number };
  return { browser, accountId: account.id };
}

beforeEach(async () => {
  for (const t of ["episodes", "feeds", "accounts", "login_attempts"]) await env.DB.prepare(`DELETE FROM ${t}`).run().catch(() => {});
});

describe("session", () => {
  it("says whether the Worker is set up and signed in", async () => {
    const browser = new Browser(createApp(fakeInternazionale([]).http));
    expect(await (await browser.request("/api/session")).json()).toEqual({ setupMissing: [], signedIn: false });
    expect((await browser.request("/api/state")).status).toBe(401);
    expect((await browser.signIn()).status).toBe(200);
    expect(await (await browser.request("/api/session")).json()).toEqual({ setupMissing: [], signedIn: true });
  });

  it("turns down a wrong password, then stops listening after too many", async () => {
    const browser = new Browser(createApp(fakeInternazionale([]).http));
    const ip = { "CF-Connecting-IP": "203.0.113.9" };
    expect((await browser.post("/api/login", { password: "nope" }, ip)).status).toBe(401);
    expect(browser.cookie).toBe("");
    for (let i = 0; i < 9; i++) await browser.post("/api/login", { password: "nope" }, ip);
    expect((await browser.post("/api/login", { password: PASSWORD }, ip)).status).toBe(429);
  });

  it("refuses changes from another site, and anything but JSON", async () => {
    const { browser, accountId } = await connected(fakeInternazionale([]));
    expect((await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "a-voce" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await browser.request(`/api/accounts/${accountId}`, { method: "DELETE", headers: { Origin: "null" } })).status).toBe(403);
    const form = await browser.request(`/api/accounts/${accountId}/feeds`, { method: "POST", body: "slug=a-voce", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
  });
});

describe("from account to feed", () => {
  it("signs in to the publisher, makes feeds, and serves each only at its secret address", async () => {
    const fake = fakeInternazionale([
      { id: 2, title: "Secondo & ultimo", access: "limited", keyed: true },
      { id: 1, title: "Primo", access: "public", keyed: false, publishedAt: "2026-11-01 09:00:00" },
    ]);
    const browser = new Browser(createApp(fake.http));
    await browser.signIn();

    const bad = await browser.post("/api/accounts", { ...LOGIN, credentials: { email: "me@example.test", password: "wrong" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("refused the sign-in");

    const added = await browser.post("/api/accounts", LOGIN);
    expect(added.status).toBe(201);
    const { id: accountId } = (await added.json()) as { id: number };

    // Credentials are stored sealed, never in the clear.
    const row = await env.DB.prepare("SELECT credentials_sealed FROM accounts").first<{ credentials_sealed: string }>();
    expect(row!.credentials_sealed).not.toContain("secret");
    expect(row!.credentials_sealed).not.toContain("me@example.test");

    const shows = (await (await browser.request(`/api/accounts/${accountId}/shows`)).json()) as ShowChoice[];
    expect(shows.map((s) => s.slug)).toEqual(["a-voce", "il-mondo-cultura", "limoni"]);
    expect(shows.every((s) => s.feedId === null)).toBe(true);

    // The app adds ticked shows one by one.
    for (const s of shows.slice(0, 2)) {
      const r = await browser.post(`/api/accounts/${accountId}/feeds`, { slug: s.slug, title: s.title });
      expect(r.status).toBe(201);
      expect(((await r.json()) as { error?: string; newEpisodes: number })).toMatchObject({ newEpisodes: 2 });
    }
    const after = (await (await browser.request(`/api/accounts/${accountId}/shows`)).json()) as ShowChoice[];
    expect(after.filter((s) => s.feedId !== null).map((s) => s.slug)).toEqual(["a-voce", "il-mondo-cultura"]);

    const { feeds } = await browser.state();
    expect(feeds).toHaveLength(2);
    const feed = feeds.find((f) => f.slug === "a-voce")!;
    expect(feed).toMatchObject({ title: "A voce", episodes: 2, enabled: true, lastError: null });
    expect(feed.url).toMatch(/^https:\/\/proxy\.example\.test\/feed\/[A-Za-z0-9_-]{43}\/a-voce\.xml$/);

    const stranger = new Browser(createApp(fake.http));
    const res = await stranger.request(new URL(feed.url).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<itunes:block>Yes</itunes:block>");
    expect(xml).toContain('<enclosure url="https://api.spreaker.com/v2/episodes/2/play.mp3?key=testkey--2" length="0" type="audio/mpeg"/>');
    expect(xml).toContain("<title>Secondo &amp; ultimo</title>");
    expect(xml).toContain('<guid isPermaLink="false">spreaker:2</guid>');
    expect(xml.indexOf("spreaker:2")).toBeLessThan(xml.indexOf("spreaker:1"));
    expect(xml).toContain("]]]]><![CDATA[>");

    expect((await stranger.request(new URL(feed.url).pathname, { headers: { "If-None-Match": res.headers.get("ETag")! } })).status).toBe(304);
    expect((await stranger.request("/feed/not-the-token/a-voce.xml")).status).toBe(404);
    expect((await stranger.request("/api/state")).status).toBe(401);
  });

  it("refuses a slug that isn't one", async () => {
    const { browser, accountId } = await connected(fakeInternazionale([]));
    expect((await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "a-voce\r" })).status).toBe(400);
    expect((await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "../etc" })).status).toBe(400);
  });

  it("gives a feed a new address that replaces the old one, and pauses it", async () => {
    const { browser, accountId } = await connected(fakeInternazionale([{ id: 1, title: "Uno", access: "limited", keyed: true }]));
    await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "a-voce" });
    const [before] = (await browser.state()).feeds as [FeedInfo];
    expect((await browser.post(`/api/feeds/${before.id}/rotate`)).status).toBe(200);
    const [after] = (await browser.state()).feeds as [FeedInfo];
    expect(after.url).not.toBe(before.url);
    expect((await browser.request(new URL(before.url).pathname)).status).toBe(404);
    expect((await browser.request(new URL(after.url).pathname)).status).toBe(200);

    await browser.request(`/api/feeds/${after.id}`, { method: "PATCH", json: { enabled: false } });
    expect((await browser.state()).feeds[0]!.enabled).toBe(false);
    expect((await browser.request(new URL(after.url).pathname)).status).toBe(404);
  });

  it("records a failure on the feed when the audio stays locked", async () => {
    const fake = fakeInternazionale([{ id: 1, title: "Uno", access: "limited", keyed: false }]);
    const { browser, accountId } = await connected(fake);
    const r = (await (await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "a-voce" })).json()) as { error?: string };
    expect(r.error).toContain("still hid the subscriber audio");
    expect((await browser.state()).feeds[0]!.lastError).toContain("still hid the subscriber audio");
    // It signed in again once before giving up.
    expect(fake.calls.filter((u) => u.endsWith("/users/login/")).length).toBe(2);
  });

  it("removes an account with its feeds", async () => {
    const { browser, accountId } = await connected(fakeInternazionale([{ id: 1, title: "Uno", access: "limited", keyed: true }]));
    await browser.post(`/api/accounts/${accountId}/feeds`, { slug: "a-voce" });
    const [feed] = (await browser.state()).feeds as [FeedInfo];
    await browser.request(`/api/accounts/${accountId}`, { method: "DELETE" });
    const state = await browser.state();
    expect(state.accounts).toEqual([]);
    expect(state.feeds).toEqual([]);
    expect((await browser.request(new URL(feed.url).pathname)).status).toBe(404);
  });
});
