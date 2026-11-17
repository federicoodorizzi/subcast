import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Http } from "../src/providers/types";
import { createApp } from "../src/web/app";
import { fakeJwt, podcastIndex, showPage, type FakeEpisode } from "./fixtures";

const ORIGIN = "https://proxy.example.test";
const PASSWORD = env.ADMIN_PASSWORD;

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

class Browser {
  cookie = "";
  constructor(private app: ReturnType<typeof createApp>) {}

  async request(path: string, init: RequestInit & { form?: Record<string, string | string[]> } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("Cookie", this.cookie);
    let body = init.body;
    if (init.form) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(init.form)) for (const one of [v].flat()) form.append(k, one);
      body = form;
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
    }
    const res = await this.app.fetch(new Request(ORIGIN + path, { ...init, headers, body, redirect: "manual" }), env);
    const set = res.headers.get("Set-Cookie");
    if (set) this.cookie = set.split(";")[0]!;
    return res;
  }

  signIn() {
    return this.request("/login", { method: "POST", form: { password: PASSWORD } });
  }
}

async function feedUrls(browser: Browser): Promise<string[]> {
  const html = await (await browser.request("/")).text();
  return [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

beforeEach(async () => {
  for (const t of ["episodes", "feeds", "accounts", "login_attempts"]) await env.DB.prepare(`DELETE FROM ${t}`).run().catch(() => {});
});

describe("admin pages", () => {
  it("sends strangers to sign in, and turns down a wrong password", async () => {
    const browser = new Browser(createApp(fakeInternazionale([]).http));
    const home = await browser.request("/");
    expect(home.status).toBe(302);
    expect(home.headers.get("Location")).toBe("/login");
    const wrong = await browser.request("/login", { method: "POST", form: { password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(browser.cookie).toBe("");
  });

  it("refuses a POST from another site", async () => {
    const browser = new Browser(createApp(fakeInternazionale([]).http));
    await browser.signIn();
    const res = await browser.request("/accounts?provider=internazionale", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      form: { label: "x", cred_email: "me@example.test", cred_password: "secret" },
    });
    expect(res.status).toBe(403);
  });

  it("stops answering after too many wrong passwords", async () => {
    const browser = new Browser(createApp(fakeInternazionale([]).http));
    for (let i = 0; i < 10; i++) await browser.request("/login", { method: "POST", form: { password: "nope" }, headers: { "CF-Connecting-IP": "203.0.113.9" } });
    const res = await browser.request("/login", { method: "POST", form: { password: PASSWORD }, headers: { "CF-Connecting-IP": "203.0.113.9" } });
    expect(res.status).toBe(429);
  });
});

describe("from account to feed", () => {
  it("signs in to the publisher, makes a feed, and serves it only at its secret address", async () => {
    const fake = fakeInternazionale([
      { id: 2, title: "Secondo & ultimo", access: "limited", keyed: true },
      { id: 1, title: "Primo", access: "public", keyed: false, publishedAt: "2026-11-01 09:00:00" },
    ]);
    const browser = new Browser(createApp(fake.http));
    expect((await browser.signIn()).status).toBe(303);

    const bad = await browser.request("/accounts?provider=internazionale", { method: "POST", form: { label: "Mine", cred_email: "me@example.test", cred_password: "wrong" } });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("refused the sign-in");

    const added = await browser.request("/accounts?provider=internazionale", { method: "POST", form: { label: "Mine", cred_email: "me@example.test", cred_password: "secret" } });
    expect(added.status).toBe(303);
    const showsPath = added.headers.get("Location")!;
    expect(await (await browser.request(showsPath)).text()).toContain("Il Mondo cultura");

    // Credentials are stored sealed, never in the clear.
    const row = await env.DB.prepare("SELECT credentials_sealed, session_sealed FROM accounts").first<{ credentials_sealed: string; session_sealed: string }>();
    expect(row!.credentials_sealed).not.toContain("secret");
    expect(row!.credentials_sealed).not.toContain("me@example.test");

    expect((await browser.request(showsPath, { method: "POST", form: { show: "a-voce\nA voce" } })).status).toBe(303);
    const [url] = await feedUrls(browser);
    expect(url).toMatch(/^https:\/\/proxy\.example\.test\/feed\/[A-Za-z0-9_-]{43}\/a-voce\.xml$/);

    const stranger = new Browser(createApp(fake.http));
    const feed = await stranger.request(new URL(url!).pathname);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("Content-Type")).toContain("application/rss+xml");
    const xml = await feed.text();
    expect(xml).toContain("<itunes:block>Yes</itunes:block>");
    expect(xml).toContain('<enclosure url="https://api.spreaker.com/v2/episodes/2/play.mp3?key=testkey--2" length="0" type="audio/mpeg"/>');
    expect(xml).toContain("<title>Secondo &amp; ultimo</title>");
    expect(xml).toContain('<guid isPermaLink="false">spreaker:2</guid>');
    expect(xml.indexOf("spreaker:2")).toBeLessThan(xml.indexOf("spreaker:1"));
    expect(xml).toContain("]]]]><![CDATA[>");

    const again = await stranger.request(new URL(url!).pathname, { headers: { "If-None-Match": feed.headers.get("ETag")! } });
    expect(again.status).toBe(304);

    expect((await stranger.request("/feed/not-the-token/a-voce.xml")).status).toBe(404);
  });

  it("gives a feed a new address that replaces the old one", async () => {
    const fake = fakeInternazionale([{ id: 1, title: "Uno", access: "limited", keyed: true }]);
    const browser = new Browser(createApp(fake.http));
    await browser.signIn();
    const added = await browser.request("/accounts?provider=internazionale", { method: "POST", form: { label: "Mine", cred_email: "me@example.test", cred_password: "secret" } });
    await browser.request(added.headers.get("Location")!, { method: "POST", form: { show: "a-voce\nA voce" } });
    const [before] = await feedUrls(browser);
    const feedId = (await env.DB.prepare("SELECT id FROM feeds").first<{ id: number }>())!.id;
    await browser.request(`/feeds/${feedId}/rotate`, { method: "POST", form: {} });
    const [after] = await feedUrls(browser);
    expect(after).not.toBe(before);
    expect((await browser.request(new URL(before!).pathname)).status).toBe(404);
    expect((await browser.request(new URL(after!).pathname)).status).toBe(200);
  });

  it("records a failure on the feed when the audio stays locked", async () => {
    const fake = fakeInternazionale([{ id: 1, title: "Uno", access: "limited", keyed: false }]);
    const browser = new Browser(createApp(fake.http));
    await browser.signIn();
    const added = await browser.request("/accounts?provider=internazionale", { method: "POST", form: { label: "Mine", cred_email: "me@example.test", cred_password: "secret" } });
    await browser.request(added.headers.get("Location")!, { method: "POST", form: { show: "a-voce\nA voce" } });
    const feed = await env.DB.prepare("SELECT last_error FROM feeds").first<{ last_error: string }>();
    expect(feed!.last_error).toContain("still hid the subscriber audio");
    // It signed in again once before giving up.
    expect(fake.calls.filter((u) => u.endsWith("/users/login/")).length).toBe(2);
  });
});
