import { base64UrlToBytes } from "../crypto";
import { decodeHtmlEntities, stripTags } from "../html";
import { CredentialsError, ProviderChangedError, SessionExpiredError, type Episode, type Http, type Provider, type Show, type ShowSummary } from "./types";

// Internazionale signs in through a JSON API that answers with a JWT, which its site keeps in the
// `internaz_auth_tkn` cookie for 7 days. Each show page embeds the show and its 20 newest episodes as
// JSON in a <spreaker :show="..."> attribute, subscriber episodes carrying a keyed Spreaker URL.

const SITE = "https://www.internazionale.it";
const LOGIN_URL = "https://api.internazionale.it/users/login/";
const AUTH_COOKIE = "internaz_auth_tkn";

interface RawEpisode {
  episode_id: number;
  title: string;
  description_html?: string;
  duration?: string;
  published_at: string;
  slug?: string;
  playback_url?: string;
  access?: string;
}

interface RawShow {
  title: string;
  show_id: number;
  brief?: string;
  image?: string;
  image_url?: string;
  episodes: RawEpisode[];
}

export const internazionale: Provider = {
  id: "internazionale",
  name: "Internazionale",
  homepage: SITE,
  credentialFields: [
    { name: "email", label: "Email", type: "email", autocomplete: "username" },
    { name: "password", label: "Password", type: "password", autocomplete: "current-password" },
  ],

  async login(credentials, http) {
    const res = await http(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://utente.internazionale.it", Referer: "https://utente.internazionale.it/login" },
      body: JSON.stringify({ email: credentials.email ?? "", psw: credentials.password ?? "" }),
    });
    const body = (await res.json().catch(() => null)) as { response?: string; info?: { token?: string; message?: string }; token?: string } | null;
    if (res.status === 401 || res.status === 400 || body?.response === "ko") {
      throw new CredentialsError(`Internazionale refused the sign-in (${body?.info?.message ?? `HTTP ${res.status}`})`);
    }
    const token = body?.info?.token || body?.token;
    if (!res.ok || !token) throw new ProviderChangedError(`Internazionale's sign-in answered HTTP ${res.status} without a token`);
    const claims = jwtClaims(token);
    if (!isSubscribed(claims)) throw new CredentialsError("This Internazionale account has no active subscription");
    const exp = typeof claims.exp === "number" ? claims.exp * 1000 : Date.now() + 6 * 86_400_000;
    return { data: { token }, expiresAt: exp };
  },

  async listShows(http) {
    const res = await http(`${SITE}/podcast`);
    if (!res.ok) throw new ProviderChangedError(`Internazionale's podcast page answered HTTP ${res.status}`);
    return parseShowList(await res.text());
  },

  async fetchShow(slug, session, http) {
    const link = `${SITE}/podcast/${encodeURIComponent(slug)}`;
    const res = await http(link, { headers: { Cookie: `${AUTH_COOKIE}=${session.data.token}` } });
    if (res.status === 404) throw new ProviderChangedError(`Internazionale has no podcast at /podcast/${slug}`);
    if (!res.ok) throw new ProviderChangedError(`Internazionale's page for ${slug} answered HTTP ${res.status}`);
    return parseShowPage(await res.text(), link);
  },
};

export function parseShowList(html: string): ShowSummary[] {
  // Each show is linked twice, from its picture and from its name: keep both.
  const shows = new Map<string, ShowSummary>();
  for (const m of html.matchAll(/<a\s[^>]*href="(?:https:\/\/www\.internazionale\.it)?\/podcast\/([a-z0-9-]+)\/?"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1]!;
    const show = shows.get(slug) ?? { slug, title: "" };
    const title = decodeHtmlEntities(stripTags(m[2]!)).trim();
    const image = m[2]!.match(/<img\s[^>]*src="(https:\/\/[^"]+)"/)?.[1];
    if (title && !show.title) show.title = title;
    if (image && !show.imageUrl) show.imageUrl = decodeHtmlEntities(image);
    shows.set(slug, show);
  }
  return [...shows.values()].map((s) => ({ ...s, title: s.title || s.slug })).sort((a, b) => a.title.localeCompare(b.title, "it"));
}

export function parseShowPage(html: string, link: string): Show {
  const m = html.match(/<spreaker\s[^>]*:show="([^"]*)"/);
  if (!m) throw new ProviderChangedError("Internazionale's show page has no <spreaker :show> data any more");
  let raw: RawShow;
  try {
    raw = JSON.parse(decodeHtmlEntities(m[1]!)) as RawShow;
  } catch {
    throw new ProviderChangedError("Internazionale's <spreaker :show> data isn't JSON any more");
  }
  if (!Array.isArray(raw.episodes)) throw new ProviderChangedError("Internazionale's show data has no episode list");

  const episodes: Episode[] = [];
  let locked = 0;
  for (const e of raw.episodes) {
    const url = e.playback_url ?? "";
    // Subscriber episodes are "limited"; their audio needs the key the page adds for a subscriber.
    if (e.access === "limited" && !/[?&]key=/.test(url)) {
      locked++;
      continue;
    }
    if (!/^https:\/\//.test(url)) continue;
    episodes.push({
      guid: `spreaker:${e.episode_id}`,
      title: e.title,
      descriptionHtml: e.description_html ?? "",
      publishedAt: romeTimeToEpochMs(e.published_at),
      durationSeconds: e.duration ? Math.round(Number(e.duration) / 1000) || null : null,
      audioUrl: url,
      audioType: "audio/mpeg",
      link: e.slug ? `${link}/${e.slug}` : link,
      imageUrl: null,
    });
  }
  if (locked > 0) throw new SessionExpiredError(`${locked} subscriber episode(s) came back without their audio`);

  return {
    title: raw.title,
    descriptionHtml: raw.brief ?? "",
    author: "Internazionale",
    language: "it",
    link,
    imageUrl: raw.image_url || spreakerOriginal(raw.image) || null,
    episodes,
  };
}

/** Spreaker's artwork URLs carry a resizing step (t_square_limited_160); without it they serve the original. */
function spreakerOriginal(url: string | undefined): string | undefined {
  return url?.replace(/\/t_[a-z0-9_]+\/(images\.spreaker\.com\/)/, "/$1");
}

function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split(".")[1]!))) as Record<string, unknown>;
  } catch {
    throw new ProviderChangedError("Internazionale's sign-in token isn't a JWT any more");
  }
}

function isSubscribed(claims: Record<string, unknown>): boolean {
  const truthy = (v: unknown) => v === true || v === "true";
  const sub = claims.in_subscription as { is_subscribed?: unknown } | undefined;
  return truthy(sub?.is_subscribed) || truthy(claims.is_subscribed);
}

/** "2026-11-13 11:55:01" in Rome's local time, as Internazionale writes it, to epoch milliseconds. */
export function romeTimeToEpochMs(local: string): number {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return Date.now();
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  // Rome's offset at that moment: format the instant in Rome and see how far it is from UTC.
  const offsetAt = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - t;
  };
  const guess = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(guess);
}

