// Takes the README's screenshots: `pnpm screenshots`.
//
// It runs the app with the Vite dev server and answers every /api request with the made-up demo data
// below, so the pictures show no real publisher, show, artwork or feed address, and need no account
// or secrets. Each screen is shot at phone size, then the screens are set side by side in phone
// frames, once light and once dark, into docs/screenshots/. It uses the Google Chrome installed on
// this machine (or CHROME_PATH).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page, type Route } from "playwright-core";

const PORT = 5288;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = "docs/screenshots";
const HOUR = 3_600_000;
const now = Date.now();

// Demo data

function cover(title: string, from: string, to: string, shape: "circle" | "wave" | "bars" | "ring"): string {
  const shapes = {
    circle: `<circle cx="300" cy="260" r="150" fill="#fff" opacity=".9"/><circle cx="300" cy="260" r="70" fill="${to}"/>`,
    wave: `<path d="M40 300 C 140 180, 220 420, 320 300 S 500 180, 560 300" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" opacity=".9"/>`,
    bars: [0, 1, 2, 3, 4].map((i) => `<rect x="${130 + i * 72}" y="${300 - [90, 160, 220, 140, 70][i]! / 1}" width="44" height="${[180, 320, 440, 280, 140][i]}" rx="22" fill="#fff" opacity=".9"/>`).join(""),
    ring: `<circle cx="300" cy="260" r="150" fill="none" stroke="#fff" stroke-width="40" opacity=".9"/><circle cx="300" cy="260" r="48" fill="#fff"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/>${shapes[shape]}<text x="300" y="530" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#fff">${title}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const publisherIcon = (letter: string, color: string) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><text x="50" y="68" text-anchor="middle" font-family="Georgia, serif" font-size="58" font-weight="700" fill="#fff">${letter}</text></svg>`).toString("base64")}`;

const providers = [
  { id: "demo-press", name: "Demo Press", homepage: "https://example.com", iconUrl: publisherIcon("D", "#1d4ed8"), credentialFields: [] },
  { id: "sample-radio", name: "Sample Radio", homepage: "https://example.com", iconUrl: publisherIcon("S", "#047857"), credentialFields: [] },
];

const shows = [
  { slug: "the-morning", title: "The Morning", imageUrl: cover("The Morning", "#f97316", "#db2777", "circle") },
  { slug: "long-reads", title: "Long Reads", imageUrl: cover("Long Reads", "#0ea5e9", "#4f46e5", "wave") },
  { slug: "weekly-world", title: "Weekly World", imageUrl: cover("Weekly World", "#10b981", "#0f766e", "ring") },
  { slug: "science-hour", title: "Science Hour", imageUrl: cover("Science Hour", "#8b5cf6", "#1e1b4b", "bars") },
  { slug: "culture-notes", title: "Culture Notes", imageUrl: cover("Culture Notes", "#eab308", "#c2410c", "circle") },
  { slug: "book-club", title: "Book Club", imageUrl: cover("Book Club", "#f43f5e", "#7c2d12", "ring") },
  { slug: "money-matters", title: "Money Matters", imageUrl: cover("Money Matters", "#22c55e", "#166534", "bars") },
  { slug: "after-dark", title: "After Dark", imageUrl: cover("After Dark", "#334155", "#020617", "wave") },
];

const followed = ["the-morning", "long-reads", "weekly-world", "science-hour"];
const feeds = followed.map((slug, i) => {
  const show = shows.find((s) => s.slug === slug)!;
  return {
    id: i + 1,
    accountId: 1,
    slug,
    title: show.title,
    author: "Demo Press",
    imageUrl: show.imageUrl,
    link: "https://example.com",
    enabled: i !== 3,
    episodes: [184, 62, 41, 120][i]!,
    latestEpisodeAt: now - [2, 20, 49, 140][i]! * HOUR,
    lastRefreshedAt: now - 12 * 60_000,
    lastError: null,
    url: `https://podcasts.example.com/feed/q7Zk3VbN2xLw9cRt4mHs8pYd1fGa6eJu0oKi5WnXyTE/${slug}.xml`,
  };
});

const state = {
  providers,
  accounts: [
    { id: 1, provider: "demo-press", label: "Demo Press", lastError: null, createdAt: now - 30 * 24 * HOUR },
    { id: 2, provider: "sample-radio", label: "Sample Radio", lastError: null, createdAt: now - 9 * 24 * HOUR },
  ],
  feeds,
};

const episodeTitles = [
  "Why cities are planting forests on their rooftops",
  "The quiet return of the night train",
  "What a single glacier tells us about the century",
  "Inside the race to build a better battery",
  "How a small library became a town's living room",
  "The long afterlife of a forgotten novel",
];

async function answer(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname.replace(/^\/api/, "");
  const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/session") return json({ setupMissing: [], signedIn: true });
  if (path === "/state") return json(state);
  if (/^\/feeds\/\d+\/episodes$/.test(path))
    return json(episodeTitles.map((title, i) => ({ guid: `demo:${i}`, title, publishedAt: now - (2 + i * 26) * HOUR, durationSeconds: 1500 + i * 240, link: null })));
  if (/^\/accounts\/\d+\/shows$/.test(path)) return json(shows.map((s) => ({ ...s, subscriberOnly: s.slug !== "after-dark", feedId: followed.includes(s.slug) ? followed.indexOf(s.slug) + 1 : null })));
  return json({ ok: true });
}

// Shooting

async function startDevServer() {
  const server = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) return server;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error("The dev server didn't start");
}

type Shot = { name: string; go: (page: Page) => Promise<void> };

const shots: Shot[] = [
  { name: "home", go: async (p) => void (await p.goto(`${ORIGIN}/`), await p.getByText("Science Hour").waitFor()) },
  {
    name: "show",
    go: async (p) => {
      await p.goto(`${ORIGIN}/`);
      await p.getByRole("button", { name: "Open The Morning" }).click();
      await p.getByText("Latest episodes").waitFor();
    },
  },
  {
    name: "picker",
    go: async (p) => {
      await p.goto(`${ORIGIN}/accounts/1/shows`);
      await p.getByText("Available").waitFor();
      for (const t of ["Culture Notes", "Money Matters"]) await p.locator("label", { hasText: t }).click();
    },
  },
  { name: "accounts", go: async (p) => void (await p.goto(`${ORIGIN}/accounts`), await p.getByText("Connected").waitFor()) },
];

function frame(images: string[], scheme: "light" | "dark"): string {
  const bezel = scheme === "dark" ? "#2a2a2e" : "#d4d4d8";
  return `<html><body style="margin:0;background:transparent">
<div id="sheet" style="display:flex;gap:56px;padding:48px;width:max-content">
${images.map((src) => `<div style="width:390px;height:844px;border-radius:56px;padding:12px;background:${bezel};box-shadow:0 30px 60px -20px rgba(0,0,0,.35)"><img src="${src}" style="display:block;width:390px;height:844px;border-radius:44px"></div>`).join("")}
</div></body></html>`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startDevServer();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  try {
    for (const scheme of ["light", "dark"] as const) {
      const images: string[] = [];
      for (const shot of shots) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme });
        const page = await context.newPage();
        await page.route("**/api/**", answer);
        await shot.go(page);
        await page.waitForTimeout(700); // let sheets and toasts settle
        images.push(`data:image/png;base64,${(await page.screenshot()).toString("base64")}`);
        await context.close();
      }
      const sheet = await browser.newPage({ deviceScaleFactor: 1.5 });
      await sheet.setContent(frame(images, scheme));
      const file = `${OUT}/screens-${scheme}.png`;
      writeFileSync(file, await sheet.locator("#sheet").screenshot({ omitBackground: true }));
      await sheet.close();
      console.log(`wrote ${file}`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

await main();
