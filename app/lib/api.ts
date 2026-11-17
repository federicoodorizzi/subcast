import type { AccountInfo, EpisodeInfo, RefreshInfo, SessionInfo, ShowChoice, State } from "../../src/api-types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Called when any request finds the session gone, so the app can show the sign-in screen. */
let onSignedOut: () => void = () => {};
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") onSignedOut();
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  session: () => request<SessionInfo>("GET", "/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/logout"),
  state: () => request<State>("GET", "/state"),
  addAccount: (provider: string, label: string, credentials: Record<string, string>) => request<AccountInfo>("POST", "/accounts", { provider, label, credentials }),
  updateAccount: (id: number, patch: { label?: string; credentials?: Record<string, string> }) => request<AccountInfo>("PATCH", `/accounts/${id}`, patch),
  deleteAccount: (id: number) => request<{ ok: true }>("DELETE", `/accounts/${id}`),
  shows: (accountId: number) => request<ShowChoice[]>("GET", `/accounts/${accountId}/shows`),
  addFeed: (accountId: number, slug: string, title: string) => request<RefreshInfo>("POST", `/accounts/${accountId}/feeds`, { slug, title }),
  episodes: (feedId: number) => request<EpisodeInfo[]>("GET", `/feeds/${feedId}/episodes`),
  refresh: (feedId: number) => request<RefreshInfo>("POST", `/feeds/${feedId}/refresh`),
  setEnabled: (feedId: number, enabled: boolean) => request<{ ok: true }>("PATCH", `/feeds/${feedId}`, { enabled }),
  rotate: (feedId: number) => request<{ ok: true }>("POST", `/feeds/${feedId}/rotate`),
  deleteFeed: (feedId: number) => request<{ ok: true }>("DELETE", `/feeds/${feedId}`),
};
