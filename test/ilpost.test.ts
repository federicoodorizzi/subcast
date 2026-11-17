import { describe, expect, it } from "vitest";
import { ilpost, parseEpisodes, parsePodcastList } from "../src/providers/ilpost";
import { CredentialsError, SessionExpiredError, type Http } from "../src/providers/types";

// Made-up answers shaped like Il Post's API.

const parent = {
  id: "1",
  slug: "mattina",
  title: "Mattina",
  author: "Una Giornalista",
  description: "La rassegna stampa.",
  image: "https://www.ilpost.example/mattina.jpg",
  share_url: "https://www.ilpost.example/podcasts/mattina/",
  access_level: "subscriber",
};

function episode(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Ep. ${id}`,
    summary: "Breve",
    content_html: `<p>Episodio ${id}</p>`,
    date: "2026-11-17T08:03:22+01:00",
    milliseconds: "1561000",
    episode_raw_url: `https://www.ilpost.example/audio/${id}.mp3`,
    share_url: `https://www.ilpost.example/episodes/${id}`,
    image: parent.image,
    access_level: "subscriber",
    parent,
    ...extra,
  };
}

describe("parseEpisodes", () => {
  it("reads the show from the episodes' parent, and each episode", () => {
    const show = parseEpisodes("mattina", [episode(2, { image: "https://www.ilpost.example/special.jpg" }), episode(1)]);
    expect(show).toMatchObject({ title: "Mattina", author: "Una Giornalista · Il Post", imageUrl: parent.image, link: parent.share_url });
    expect(show.episodes[0]).toMatchObject({
      guid: "ilpost:2",
      publishedAt: Date.parse("2026-11-17T07:03:22Z"),
      durationSeconds: 1561,
      audioUrl: "https://www.ilpost.example/audio/2.mp3",
      imageUrl: "https://www.ilpost.example/special.jpg",
    });
    // An episode whose picture is the show's own has none of its own.
    expect(show.episodes[1]!.imageUrl).toBeNull();
  });

  it("asks for a new session when a subscriber episode has no audio", () => {
    expect(() => parseEpisodes("mattina", [episode(1, { episode_raw_url: "" })])).toThrow(SessionExpiredError);
  });
});

describe("parsePodcastList", () => {
  it("puts subscriber shows first", () => {
    const shows = parsePodcastList([
      { id: 2, slug: "aperto", title: "Aperto", access_level: "all" },
      { id: 1, slug: "mattina", title: "Mattina", image: parent.image, access_level: "subscriber" },
      { id: 3, slug: "Bad Slug!", title: "Bad" },
      { id: 4, slug: "tienimi_mattina", title: "Tienimi Mattina", access_level: "subscriber" },
    ]);
    expect(shows).toEqual([
      { slug: "mattina", title: "Mattina", imageUrl: parent.image, subscriberOnly: true },
      { slug: "tienimi_mattina", title: "Tienimi Mattina", imageUrl: undefined, subscriberOnly: true },
      { slug: "aperto", title: "Aperto", imageUrl: undefined, subscriberOnly: false },
    ]);
  });
});

describe("login", () => {
  const answer = (status: number, body: unknown): Http => async () => Response.json(body, { status });

  it("returns the token for a subscriber", async () => {
    const session = await ilpost.login({ email: "a@b.c", password: "p" }, answer(200, { data: { data: { token: "t0k", issubscriber: 1, subscription: 1 } } }));
    expect(session.data).toEqual({ token: "t0k" });
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("turns down wrong credentials and accounts without a subscription", async () => {
    await expect(ilpost.login({ email: "a@b.c", password: "x" }, answer(403, { status: 403, message: "Errore nel login", data: { data: [] } }))).rejects.toThrow(CredentialsError);
    await expect(ilpost.login({ email: "a@b.c", password: "p" }, answer(200, { data: { data: { token: "t", issubscriber: 0, subscription: 0 } } }))).rejects.toThrow(
      /no active subscription/,
    );
  });

  it("sends the credentials as a form, the way the app does", async () => {
    let sent: { body?: string; type?: string } = {};
    const http: Http = async (_url, init) => {
      sent = { body: String(init?.body), type: new Headers(init?.headers).get("Content-Type") ?? "" };
      return Response.json({ data: { data: { token: "t", issubscriber: 1 } } });
    };
    await ilpost.login({ email: "a+b@c.d", password: "p&q" }, http);
    expect(sent.type).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(sent.body)).toEqual(new URLSearchParams({ username: "a+b@c.d", password: "p&q" }));
  });
});
