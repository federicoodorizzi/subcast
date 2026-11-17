import type { EpisodeRow, FeedRow } from "./db/store";
import { cdata, decodeHtmlEntities, escapeXml, stripTags } from "./html";

/** RSS 2.0 with Apple's podcast tags. `itunes:block` keeps the feed out of Apple's public directory. */
export function renderFeed(feed: FeedRow, episodes: EpisodeRow[], selfUrl: string): string {
  const description = feed.description_html || feed.title;
  const lastBuild = episodes[0]?.published_at ?? feed.last_refreshed_at ?? feed.created_at;
  const items = episodes.map((e) => renderItem(e, feed)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(feed.title)}</title>
<link>${escapeXml(feed.link || selfUrl)}</link>
<atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
<description>${cdata(description)}</description>
<itunes:summary>${escapeXml(plain(description))}</itunes:summary>
<language>${escapeXml(feed.language || "en")}</language>
<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
<itunes:author>${escapeXml(feed.author)}</itunes:author>
<itunes:explicit>false</itunes:explicit>
<itunes:type>episodic</itunes:type>
<itunes:block>Yes</itunes:block>
${feed.image_url ? `<itunes:image href="${escapeXml(feed.image_url)}"/>\n<image><url>${escapeXml(feed.image_url)}</url><title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.link || selfUrl)}</link></image>\n` : ""}${items}</channel>
</rss>
`;
}

function renderItem(e: EpisodeRow, feed: FeedRow): string {
  return `<item>
<title>${escapeXml(e.title)}</title>
<guid isPermaLink="false">${escapeXml(e.guid)}</guid>
<pubDate>${new Date(e.published_at).toUTCString()}</pubDate>
${e.link ? `<link>${escapeXml(e.link)}</link>\n` : ""}<description>${cdata(e.description_html)}</description>
<content:encoded>${cdata(e.description_html)}</content:encoded>
<itunes:summary>${escapeXml(plain(e.description_html))}</itunes:summary>
<enclosure url="${escapeXml(e.audio_url)}" length="0" type="${escapeXml(e.audio_type)}"/>
${e.duration_seconds ? `<itunes:duration>${e.duration_seconds}</itunes:duration>\n` : ""}<itunes:author>${escapeXml(feed.author)}</itunes:author>
<itunes:episodeType>full</itunes:episodeType>
<itunes:explicit>false</itunes:explicit>
</item>
`;
}

function plain(html: string): string {
  return decodeHtmlEntities(stripTags(html.replace(/<br\s*\/?>/gi, "\n")));
}
