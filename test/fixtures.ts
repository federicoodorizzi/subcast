// Made-up pages shaped like Internazionale's, so tests never hold a real key or account.

export interface FakeEpisode {
  id: number;
  title: string;
  access: "limited" | "public";
  keyed: boolean;
  publishedAt?: string;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function showPage(title: string, episodes: FakeEpisode[]): string {
  const data = {
    title,
    show_id: 1,
    image: "https://d3wo5wojvuv7l.cloudfront.net/t_square_limited_160/images.spreaker.com/original/abc.jpg",
    image_url: "https://media.example.test/show-hd.jpg",
    brief: "Il podcast <strong>di prova</strong> & altro",
    episodes_sorting: "DESC",
    episodes: episodes.map((e) => ({
      episode_id: e.id,
      type: "podcast_episode",
      title: e.title,
      duration: "1843365",
      published_at: e.publishedAt ?? "2026-11-13 11:55:01",
      slug: `episodio-${e.id}`,
      playback_url: `https://api.spreaker.com/v2/episodes/${e.id}/play.mp3${e.keyed ? `?key=testkey--${e.id}` : ""}`,
      description_html: `<p>Descrizione dell’episodio ${e.id} ]]> fine</p>`,
      access: e.access,
    })),
  };
  return `<!doctype html><html><body><div id="podcast-show"><spreaker :show="${escapeAttr(JSON.stringify(data))}"></spreaker></div></body></html>`;
}

export const podcastIndex = `<!doctype html><html><body>
<a href="/podcast/a-voce"><picture><img src="https://media.example.test/a-voce-ld.jpg" alt="podcast image" /></picture></a>
<a href="/podcast/a-voce">A voce</a>
<a href="https://www.internazionale.it/podcast/il-mondo-cultura">Il Mondo cultura</a>
<a href="/podcast/limoni"><img src="y.jpg" alt=""></a>
</body></html>`;

export function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.signature`;
}
