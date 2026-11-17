import { sha256Hex } from "./crypto";
import type { Http } from "./providers/types";

// Podcast apps want square artwork of at least 1400×1400 px; Apple Podcasts shows smaller or missing
// artwork poorly, and falls back to the picture inside the MP3 for an episode with none of its own.
// Feeds point every image at /feed/<token>/art/..., which serves the publisher's picture as it is when
// it's already big and square enough, and otherwise resizes it with Cloudflare Images.

const MIN_SIDE = 1400;
const CACHE_SECONDS = 7 * 86400;

export async function serveArtwork(source: string, images: ImagesBinding | undefined, http: Http, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const cache = typeof caches !== "undefined" ? caches.default : undefined;
  const key = new Request(`https://artwork.cache/${await sha256Hex(source)}`);
  const hit = await cache?.match(key);
  if (hit) return hit;

  const original = await http(source);
  if (!original.ok || !original.body) return Response.redirect(source, 302);
  const bytes = await original.arrayBuffer();
  const type = original.headers.get("Content-Type") ?? "";

  let response: Response;
  try {
    response = images ? await fitted(bytes, type, images) : new Response(bytes, { headers: { "Content-Type": type || "image/jpeg" } });
  } catch (err) {
    // Images may be unavailable on this account; the original still beats nothing.
    console.warn(`artwork: couldn't resize (${err instanceof Error ? err.message : String(err)})`);
    response = new Response(bytes, { headers: { "Content-Type": type || "image/jpeg" } });
  }
  response = new Response(response.body, response);
  response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  response.headers.set("X-Robots-Tag", "noindex");
  const put = cache?.put(key, response.clone());
  if (put) ctx ? ctx.waitUntil(put) : await put;
  return response;
}

async function fitted(bytes: ArrayBuffer, type: string, images: ImagesBinding): Promise<Response> {
  const info = await images.info(stream(bytes));
  if ("width" in info) {
    const square = Math.abs(info.width - info.height) <= 2;
    const plain = /^image\/(jpeg|png)$/.test(info.format);
    if (square && plain && info.width >= MIN_SIDE && info.width <= 3000) return new Response(bytes, { headers: { "Content-Type": info.format || type } });
  }
  const side = "width" in info ? Math.min(3000, Math.max(MIN_SIDE, Math.min(info.width, info.height))) : MIN_SIDE;
  const result = await images.input(stream(bytes)).transform({ width: side, height: side, fit: "cover" }).output({ format: "image/jpeg", quality: 90 });
  return result.response();
}

function stream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body!;
}
