import type { AccountRow, FeedRow, Store } from "./db/store";
import { getProvider, publisherFetch } from "./providers";
import { CredentialsError, SessionExpiredError, type Http, type Provider, type ProviderSession } from "./providers/types";

const RENEW_BEFORE_MS = 86_400_000;

export interface RefreshResult {
  feedId: number;
  title: string;
  newEpisodes: number;
  error?: string;
}

/** Brings every enabled feed up to date, one publisher request at a time. */
export async function refreshAll(store: Store, http: Http = publisherFetch): Promise<RefreshResult[]> {
  const feeds = await store.listEnabledFeeds();
  const results: RefreshResult[] = [];
  const byAccount = Map.groupBy(feeds, (f) => f.account_id);
  for (const [accountId, accountFeeds] of byAccount) {
    const account = await store.getAccount(accountId);
    if (!account) continue;
    for (const feed of accountFeeds) results.push(await refreshFeed(store, account, feed, http));
  }
  return results;
}

/** Fetches one feed's show and saves what's new. Never throws: failures are recorded on the feed. */
export async function refreshFeed(store: Store, account: AccountRow, feed: FeedRow, http: Http = publisherFetch): Promise<RefreshResult> {
  const provider = getProvider(account.provider);
  const result: RefreshResult = { feedId: feed.id, title: feed.title, newEpisodes: 0 };
  try {
    if (!provider) throw new Error(`No provider called "${account.provider}"`);
    let session = await validSession(store, account, provider, http);
    let show;
    try {
      show = await provider.fetchShow(feed.show_slug, session, http);
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) throw err;
      // Signed out early, or the publisher dropped the session: sign in once more and retry.
      session = await signIn(store, account, provider, http);
      show = await provider.fetchShow(feed.show_slug, session, http);
    }
    result.newEpisodes = await store.saveShow(feed.id, show);
    result.title = show.title;
    if (show.episodes.length === 0) console.warn(`refresh: feed ${feed.id} (${feed.show_slug}) has no playable episodes`);
  } catch (err) {
    result.error = describe(err);
    console.error(`refresh: feed ${feed.id} (${feed.show_slug}) failed: ${result.error}`);
    await store.setFeedError(feed.id, result.error);
  }
  return result;
}

async function validSession(store: Store, account: AccountRow, provider: Provider, http: Http): Promise<ProviderSession> {
  const session = await store.session(account);
  if (session && session.expiresAt - RENEW_BEFORE_MS > Date.now()) return session;
  return signIn(store, account, provider, http);
}

async function signIn(store: Store, account: AccountRow, provider: Provider, http: Http): Promise<ProviderSession> {
  try {
    const session = await provider.login(await store.credentials(account), http);
    await store.saveSession(account.id, session);
    return session;
  } catch (err) {
    await store.setAccountError(account.id, describe(err));
    throw err;
  }
}

function describe(err: unknown): string {
  if (err instanceof SessionExpiredError) return `Signed in, but the publisher still hid the subscriber audio: ${err.message}`;
  if (err instanceof CredentialsError) return err.message;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
