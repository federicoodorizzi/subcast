// A provider is one publisher whose subscriber podcasts the Worker turns into feeds. Adding a publisher
// means writing one of these and listing it in ./index.ts; nothing else changes.

export interface CredentialField {
  name: string;
  label: string;
  type: "email" | "password" | "text";
  autocomplete?: string;
}

/** What a provider keeps between refreshes so it needn't sign in every time. Sealed in the database. */
export interface ProviderSession {
  data: Record<string, string>;
  /** Milliseconds since the epoch; the Worker signs in again a day before this. */
  expiresAt: number;
}

export interface ShowSummary {
  slug: string;
  title: string;
  imageUrl?: string;
  /** True when only subscribers can listen, where the publisher says so. */
  subscriberOnly?: boolean;
}

export interface Episode {
  /** Stable across refreshes: the RSS guid, so changing it would make every episode new again. */
  guid: string;
  title: string;
  descriptionHtml: string;
  /** Milliseconds since the epoch. */
  publishedAt: number;
  durationSeconds: number | null;
  audioUrl: string;
  audioType: string;
  link: string | null;
  /** The episode's own artwork, when it has one unlike the show's. */
  imageUrl: string | null;
}

export interface Show {
  title: string;
  descriptionHtml: string;
  author: string;
  language: string;
  link: string;
  imageUrl: string | null;
  episodes: Episode[];
}

export type Http = (input: string, init?: RequestInit) => Promise<Response>;

export interface Provider {
  id: string;
  name: string;
  homepage: string;
  credentialFields: CredentialField[];
  /** Signs in. Throws CredentialsError when the publisher turns the credentials (or the account) down. */
  login(credentials: Record<string, string>, http: Http): Promise<ProviderSession>;
  /** The shows a subscriber could follow, for the admin page to offer. */
  listShows(http: Http): Promise<ShowSummary[]>;
  /** The show with its newest episodes. Throws SessionExpiredError when the session no longer unlocks them. */
  fetchShow(slug: string, session: ProviderSession, http: Http): Promise<Show>;
}

/** The publisher refused the credentials, or the account has no subscription: signing in again won't help. */
export class CredentialsError extends Error {
  override name = "CredentialsError";
}

/** The session stopped working; the Worker signs in again once and retries. */
export class SessionExpiredError extends Error {
  override name = "SessionExpiredError";
}

/** The publisher's page or API changed shape; this needs a code change, so it's reported loudly. */
export class ProviderChangedError extends Error {
  override name = "ProviderChangedError";
}
