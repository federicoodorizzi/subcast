// The JSON the Worker's /api answers with, shared by the Worker and the admin app (app/).

export interface SessionInfo {
  /** Secrets the Worker still needs before anything works; empty when it's ready. */
  setupMissing: string[];
  signedIn: boolean;
}

export interface CredentialFieldInfo {
  name: string;
  label: string;
  type: "email" | "password" | "text";
  autocomplete?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  homepage: string;
  iconUrl: string | null;
  credentialFields: CredentialFieldInfo[];
}

export interface AccountInfo {
  id: number;
  provider: string;
  label: string;
  lastError: string | null;
  createdAt: number;
}

export interface FeedInfo {
  id: number;
  accountId: number;
  slug: string;
  title: string;
  author: string;
  imageUrl: string | null;
  link: string;
  enabled: boolean;
  episodes: number;
  latestEpisodeAt: number | null;
  lastRefreshedAt: number | null;
  lastError: string | null;
  /** The private feed address, token included. */
  url: string;
}

export interface State {
  providers: ProviderInfo[];
  accounts: AccountInfo[];
  feeds: FeedInfo[];
}

export interface ShowChoice {
  slug: string;
  title: string;
  imageUrl: string | null;
  /** True when the publisher marks the show as for subscribers only. */
  subscriberOnly: boolean;
  feedId: number | null;
}

export interface EpisodeInfo {
  guid: string;
  title: string;
  publishedAt: number;
  durationSeconds: number | null;
  link: string | null;
}

export interface RefreshInfo {
  feedId: number;
  title: string;
  newEpisodes: number;
  error?: string;
}

export interface ApiError {
  error: string;
}
