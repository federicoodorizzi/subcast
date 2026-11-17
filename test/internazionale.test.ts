import { describe, expect, it } from "vitest";
import { internazionale, parseShowList, parseShowPage, romeTimeToEpochMs } from "../src/providers/internazionale";
import { CredentialsError, ProviderChangedError, SessionExpiredError, type Http } from "../src/providers/types";
import { fakeJwt, podcastIndex, showPage } from "./fixtures";

describe("parseShowPage", () => {
  it("reads the show and its episodes", () => {
    const show = parseShowPage(
      showPage("A voce", [
        { id: 2, title: "Secondo", access: "limited", keyed: true },
        { id: 1, title: "Primo", access: "public", keyed: false },
      ]),
      "https://www.internazionale.it/podcast/a-voce",
    );
    expect(show.title).toBe("A voce");
    expect(show.imageUrl).toBe("https://media.example.test/show-hd.jpg");
    expect(show.descriptionHtml).toBe("Il podcast <strong>di prova</strong> & altro");
    expect(show.episodes).toHaveLength(2);
    expect(show.episodes[0]).toMatchObject({
      guid: "spreaker:2",
      title: "Secondo",
      durationSeconds: 1843,
      audioUrl: "https://api.spreaker.com/v2/episodes/2/play.mp3?key=testkey--2",
      link: "https://www.internazionale.it/podcast/a-voce/episodio-2",
    });
  });

  it("asks for a new session when a subscriber episode has no key", () => {
    const html = showPage("A voce", [{ id: 1, title: "Chiuso", access: "limited", keyed: false }]);
    expect(() => parseShowPage(html, "https://x")).toThrow(SessionExpiredError);
  });

  it("fails loudly when the page changes shape", () => {
    expect(() => parseShowPage("<html>nothing</html>", "https://x")).toThrow(ProviderChangedError);
  });
});

describe("parseShowList", () => {
  it("keeps each show once, by its name", () => {
    expect(parseShowList(podcastIndex)).toEqual([
      { slug: "a-voce", title: "A voce", imageUrl: "https://media.example.test/a-voce-ld.jpg" },
      { slug: "il-mondo-cultura", title: "Il Mondo cultura" },
      { slug: "limoni", title: "limoni" },
    ]);
  });
});

describe("romeTimeToEpochMs", () => {
  it("handles winter and summer time", () => {
    expect(new Date(romeTimeToEpochMs("2026-11-13 11:55:01")).toISOString()).toBe("2026-11-13T10:55:01.000Z");
    expect(new Date(romeTimeToEpochMs("2026-07-01 08:00:00")).toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });
});

describe("login", () => {
  const answer = (status: number, body: unknown): Http => async () => Response.json(body, { status });

  it("returns the token and its expiry for a subscriber", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    const token = fakeJwt({ exp, in_subscription: { is_subscribed: "true" } });
    const session = await internazionale.login({ email: "a@b.c", password: "p" }, answer(200, { response: "ok", info: { token } }));
    expect(session).toEqual({ data: { token }, expiresAt: exp * 1000 });
  });

  it("turns down wrong credentials", async () => {
    await expect(internazionale.login({ email: "a@b.c", password: "x" }, answer(401, { response: "ko", info: { message: "login failed" } }))).rejects.toThrow(
      CredentialsError,
    );
  });

  it("turns down an account without a subscription", async () => {
    const token = fakeJwt({ exp: 9999999999, in_subscription: { is_subscribed: false } });
    await expect(internazionale.login({ email: "a@b.c", password: "p" }, answer(200, { response: "ok", info: { token } }))).rejects.toThrow(/no active subscription/);
  });
});
