import { CredentialsError, ProviderChangedError, SessionExpiredError, type Episode, type Http, type Provider, type Show, type ShowSummary } from "./types";

// Il Post's app talks to a JSON API at api-prod.ilpost.it. Signing in (a form POST) answers with an
// opaque token and the account's subscription state; every podcast call carries the token in a
// `Token` header beside the app's fixed `Apikey`. A podcast's endpoint lists its episodes newest
// first, each with a direct MP3 URL and the podcast's own details under `parent`.

const API = "https://api-prod.ilpost.it";
const SITE = "https://www.ilpost.it";
const API_KEY = "testapikey";
/** How many of a show's newest episodes each refresh asks for. Older ones stay in the feed once seen. */
const EPISODES_PER_REFRESH = 50;
/** The token's lifetime isn't published; sign in again daily. */
const SESSION_MS = 86_400_000;

interface RawPodcast {
  id: number | string;
  slug: string;
  title: string;
  author?: string;
  description?: string;
  image?: string;
  image_web?: string;
  share_url?: string;
  access_level?: string;
}

interface RawEpisode {
  id: number;
  title: string;
  author?: string;
  summary?: string;
  content_html?: string;
  date?: string;
  timestamp?: string | number;
  milliseconds?: string | number;
  episode_raw_url?: string;
  share_url?: string;
  url?: string;
  image?: string;
  access_level?: string;
  parent?: RawPodcast;
}

interface ListResponse<T> {
  data?: T[];
}

const headers = (token?: string) => ({ Apikey: API_KEY, ...(token ? { Token: token } : {}), Accept: "application/json" });

export const ilpost: Provider = {
  id: "ilpost",
  name: "Il Post",
  homepage: SITE,
  iconUrl: "https://static-prod.cdnilpost.com/wp-content/uploads/favicon/apple-touch-icon-180x180.png",
  credentialFields: [
    { name: "email", label: "Email", type: "email", autocomplete: "username" },
    { name: "password", label: "Password", type: "password", autocomplete: "current-password" },
  ],

  async login(credentials, http) {
    const res = await http(`${API}/user/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ username: credentials.email ?? "", password: credentials.password ?? "" }).toString(),
    });
    const body = (await res.json().catch(() => null)) as { message?: string; data?: { data?: { token?: string; issubscriber?: unknown; subscription?: unknown } | unknown[] } } | null;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new CredentialsError(`Il Post refused the sign-in (${body?.message ?? `HTTP ${res.status}`})`);
    }
    const user = body?.data?.data;
    const token = user && !Array.isArray(user) ? user.token : undefined;
    if (!res.ok || !token || !user || Array.isArray(user)) throw new ProviderChangedError(`Il Post's sign-in answered HTTP ${res.status} without a token`);
    const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
    if (!truthy(user.issubscriber) && !truthy(user.subscription)) throw new CredentialsError("This Il Post account has no active subscription");
    return { data: { token }, expiresAt: Date.now() + SESSION_MS };
  },

  async listShows(http) {
    const res = await http(`${API}/podcast/v1/podcast/?pg=1&hits=500`, { headers: headers() });
    if (!res.ok) throw new ProviderChangedError(`Il Post's podcast list answered HTTP ${res.status}`);
    const body = (await res.json()) as ListResponse<RawPodcast>;
    if (!Array.isArray(body.data)) throw new ProviderChangedError("Il Post's podcast list has no data any more");
    return parsePodcastList(body.data);
  },

  async fetchShow(slug, session, http) {
    const res = await http(`${API}/podcast/v1/podcast/${encodeURIComponent(slug)}/?pg=1&hits=${EPISODES_PER_REFRESH}`, { headers: headers(session.data.token) });
    if (res.status === 401 || res.status === 403) throw new SessionExpiredError(`Il Post answered HTTP ${res.status}`);
    if (res.status === 404) throw new ProviderChangedError(`Il Post has no podcast called ${slug}`);
    if (!res.ok) throw new ProviderChangedError(`Il Post's podcast ${slug} answered HTTP ${res.status}`);
    const body = (await res.json()) as ListResponse<RawEpisode>;
    if (!Array.isArray(body.data)) throw new ProviderChangedError(`Il Post's podcast ${slug} has no episode list any more`);
    return parseEpisodes(slug, body.data);
  },
};

export function parsePodcastList(podcasts: RawPodcast[]): ShowSummary[] {
  return podcasts
    .filter((p) => p.slug && /^[a-z0-9_-]{1,100}$/.test(p.slug))
    .map((p) => ({ slug: p.slug, title: p.title || p.slug, imageUrl: p.image || undefined, subscriberOnly: p.access_level === "subscriber" }))
    .sort((a, b) => Number(b.subscriberOnly) - Number(a.subscriberOnly) || a.title.localeCompare(b.title, "it"));
}

export function parseEpisodes(slug: string, raw: RawEpisode[]): Show {
  const parent = raw.find((e) => e.parent && typeof e.parent === "object")?.parent;
  const showImage = parent?.image || null;
  const episodes: Episode[] = [];
  let locked = 0;
  for (const e of raw) {
    const url = e.episode_raw_url ?? "";
    if (!/^https:\/\//.test(url)) {
      if (e.access_level === "subscriber") locked++;
      continue;
    }
    const ms = Number(e.milliseconds);
    const published = e.date ? Date.parse(e.date) : Number(e.timestamp) * 1000;
    episodes.push({
      guid: `ilpost:${e.id}`,
      title: e.title,
      descriptionHtml: e.content_html || e.summary || "",
      publishedAt: Number.isFinite(published) ? published : Date.now(),
      durationSeconds: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null,
      audioUrl: url,
      audioType: "audio/mpeg",
      link: e.share_url || e.url || null,
      imageUrl: e.image && e.image !== showImage ? e.image : null,
    });
  }
  if (locked > 0) throw new SessionExpiredError(`${locked} subscriber episode(s) came back without their audio`);
  return {
    title: parent?.title || slug,
    descriptionHtml: parent?.description ?? "",
    author: parent?.author ? `${parent.author} · Il Post` : "Il Post",
    language: "it",
    link: parent?.share_url || `${SITE}/podcasts/${slug}/`,
    imageUrl: showImage,
    episodes,
  };
}
