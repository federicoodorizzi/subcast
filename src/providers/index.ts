import { internazionale } from "./internazionale";
import type { Http, Provider } from "./types";

/** Every publisher the Worker knows. Add a new one here. */
export const providers: Provider[] = [internazionale];

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/** fetch with a browser's User-Agent, a timeout, and no caching, as providers call publishers. */
export const publisherFetch: Http = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT);
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", "it-IT,it;q=0.9,en;q=0.8");
  return fetch(input, { ...init, headers, redirect: "follow", signal: init.signal ?? AbortSignal.timeout(20_000) });
};
