import { open, randomToken, seal, sha256Hex } from "../crypto";
import type { Episode, ProviderSession, Show } from "../providers/types";

export interface AccountRow {
  id: number;
  provider: string;
  label: string;
  credentials_sealed: string;
  session_sealed: string | null;
  session_expires_at: number | null;
  last_error: string | null;
  created_at: number;
}

export interface FeedRow {
  id: number;
  account_id: number;
  show_slug: string;
  title: string;
  description_html: string;
  author: string;
  language: string;
  link: string;
  image_url: string | null;
  token_hash: string;
  token_sealed: string;
  enabled: number;
  last_refreshed_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
  created_at: number;
}

export interface EpisodeRow {
  feed_id: number;
  guid: string;
  title: string;
  description_html: string;
  published_at: number;
  duration_seconds: number | null;
  audio_url: string;
  audio_type: string;
  link: string | null;
  first_seen_at: number;
}

const credentialsBinding = (id: number) => `account:${id}:credentials`;
const sessionBinding = (id: number) => `account:${id}:session`;
const tokenBinding = (id: number) => `feed:${id}:token`;

/** Every read and write the Worker makes, so the SQL lives in one place. */
export class Store {
  constructor(
    private db: D1Database,
    private appSecret: string,
  ) {}

  // Accounts

  listAccounts(): Promise<AccountRow[]> {
    return this.all<AccountRow>("SELECT * FROM accounts ORDER BY id");
  }

  getAccount(id: number): Promise<AccountRow | null> {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
  }

  async createAccount(provider: string, label: string, credentials: Record<string, string>, session: ProviderSession): Promise<number> {
    // The row's id is part of what its secrets are sealed to, so insert first and seal after.
    const row = await this.db
      .prepare("INSERT INTO accounts (provider, label, credentials_sealed, created_at) VALUES (?, ?, '', ?) RETURNING id")
      .bind(provider, label, Date.now())
      .first<{ id: number }>();
    const id = row!.id;
    await this.db
      .prepare("UPDATE accounts SET credentials_sealed = ?, session_sealed = ?, session_expires_at = ? WHERE id = ?")
      .bind(await seal(this.appSecret, credentialsBinding(id), credentials), await seal(this.appSecret, sessionBinding(id), session), session.expiresAt, id)
      .run();
    return id;
  }

  async updateCredentials(id: number, credentials: Record<string, string>, session: ProviderSession): Promise<void> {
    await this.db
      .prepare("UPDATE accounts SET credentials_sealed = ?, session_sealed = ?, session_expires_at = ?, last_error = NULL WHERE id = ?")
      .bind(await seal(this.appSecret, credentialsBinding(id), credentials), await seal(this.appSecret, sessionBinding(id), session), session.expiresAt, id)
      .run();
  }

  credentials(account: AccountRow): Promise<Record<string, string>> {
    return open(this.appSecret, credentialsBinding(account.id), account.credentials_sealed);
  }

  async session(account: AccountRow): Promise<ProviderSession | null> {
    if (!account.session_sealed) return null;
    try {
      return await open<ProviderSession>(this.appSecret, sessionBinding(account.id), account.session_sealed);
    } catch {
      return null;
    }
  }

  async saveSession(id: number, session: ProviderSession): Promise<void> {
    await this.db
      .prepare("UPDATE accounts SET session_sealed = ?, session_expires_at = ?, last_error = NULL WHERE id = ?")
      .bind(await seal(this.appSecret, sessionBinding(id), session), session.expiresAt, id)
      .run();
  }

  async setAccountError(id: number, error: string | null): Promise<void> {
    await this.db.prepare("UPDATE accounts SET last_error = ? WHERE id = ?").bind(error, id).run();
  }

  async deleteAccount(id: number): Promise<void> {
    // D1 enforces foreign keys, so the account's feeds and their episodes go with it.
    await this.db.prepare("DELETE FROM accounts WHERE id = ?").bind(id).run();
  }

  // Feeds

  listFeeds(): Promise<FeedRow[]> {
    return this.all<FeedRow>("SELECT * FROM feeds ORDER BY title COLLATE NOCASE");
  }

  listEnabledFeeds(): Promise<FeedRow[]> {
    return this.all<FeedRow>("SELECT * FROM feeds WHERE enabled = 1 ORDER BY account_id, id");
  }

  getFeed(id: number): Promise<FeedRow | null> {
    return this.db.prepare("SELECT * FROM feeds WHERE id = ?").bind(id).first<FeedRow>();
  }

  async feedByToken(token: string): Promise<FeedRow | null> {
    return this.db.prepare("SELECT * FROM feeds WHERE token_hash = ? AND enabled = 1").bind(await sha256Hex(token)).first<FeedRow>();
  }

  /** Adds a feed for a show, or returns the one the account already has for it. */
  async createFeed(accountId: number, slug: string, title: string): Promise<number> {
    const existing = await this.db.prepare("SELECT id FROM feeds WHERE account_id = ? AND show_slug = ?").bind(accountId, slug).first<{ id: number }>();
    if (existing) return existing.id;
    const placeholder = randomToken();
    const row = await this.db
      .prepare("INSERT INTO feeds (account_id, show_slug, title, token_hash, token_sealed, created_at) VALUES (?, ?, ?, ?, '', ?) RETURNING id")
      .bind(accountId, slug, title, await sha256Hex(placeholder), Date.now())
      .first<{ id: number }>();
    await this.rotateToken(row!.id);
    return row!.id;
  }

  /** Gives the feed a new secret address; the old one stops working at once. */
  async rotateToken(id: number): Promise<void> {
    const token = randomToken();
    await this.db
      .prepare("UPDATE feeds SET token_hash = ?, token_sealed = ? WHERE id = ?")
      .bind(await sha256Hex(token), await seal(this.appSecret, tokenBinding(id), token), id)
      .run();
  }

  feedToken(feed: FeedRow): Promise<string> {
    return open<string>(this.appSecret, tokenBinding(feed.id), feed.token_sealed);
  }

  async setFeedEnabled(id: number, enabled: boolean): Promise<void> {
    await this.db.prepare("UPDATE feeds SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, id).run();
  }

  async deleteFeed(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM feeds WHERE id = ?").bind(id).run();
  }

  async setFeedError(id: number, error: string): Promise<void> {
    await this.db.prepare("UPDATE feeds SET last_error = ?, last_error_at = ? WHERE id = ?").bind(error, Date.now(), id).run();
  }

  /** Saves what a refresh found: the show's details, and any episode not seen before. Returns how many were new. */
  async saveShow(feedId: number, show: Show): Promise<number> {
    const now = Date.now();
    const statements = [
      this.db
        .prepare("UPDATE feeds SET title = ?, description_html = ?, author = ?, language = ?, link = ?, image_url = ?, last_refreshed_at = ?, last_error = NULL, last_error_at = NULL WHERE id = ?")
        .bind(show.title, show.descriptionHtml, show.author, show.language, show.link, show.imageUrl, now, feedId),
      ...show.episodes.map((e: Episode) =>
        // An episode's details may be corrected after it's out, so they're updated, but first_seen_at stays.
        this.db
          .prepare(
            `INSERT INTO episodes (feed_id, guid, title, description_html, published_at, duration_seconds, audio_url, audio_type, link, first_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (feed_id, guid) DO UPDATE SET title = excluded.title, description_html = excluded.description_html,
               published_at = excluded.published_at, duration_seconds = excluded.duration_seconds, audio_url = excluded.audio_url,
               audio_type = excluded.audio_type, link = excluded.link`,
          )
          .bind(feedId, e.guid, e.title, e.descriptionHtml, e.publishedAt, e.durationSeconds, e.audioUrl, e.audioType, e.link, now),
      ),
    ];
    const before = await this.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE feed_id = ?").bind(feedId).first<{ n: number }>();
    await this.db.batch(statements);
    const after = await this.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE feed_id = ?").bind(feedId).first<{ n: number }>();
    return (after?.n ?? 0) - (before?.n ?? 0);
  }

  episodes(feedId: number, limit = 300): Promise<EpisodeRow[]> {
    return this.db.prepare("SELECT * FROM episodes WHERE feed_id = ? ORDER BY published_at DESC LIMIT ?").bind(feedId, limit).all<EpisodeRow>().then((r) => r.results);
  }

  async episodeCounts(): Promise<Map<number, number>> {
    const rows = await this.all<{ feed_id: number; n: number }>("SELECT feed_id, COUNT(*) AS n FROM episodes GROUP BY feed_id");
    return new Map(rows.map((r) => [r.feed_id, r.n]));
  }

  // Sign-in throttling for the admin pages

  /** True when `bucket` has failed too often lately; otherwise records nothing. */
  async isThrottled(bucket: string, maxFailures: number, windowMs: number): Promise<boolean> {
    const row = await this.db.prepare("SELECT failures, window_start FROM login_attempts WHERE bucket = ?").bind(bucket).first<{ failures: number; window_start: number }>();
    return !!row && row.window_start > Date.now() - windowMs && row.failures >= maxFailures;
  }

  async recordFailure(bucket: string, windowMs: number): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO login_attempts (bucket, failures, window_start) VALUES (?, 1, ?)
         ON CONFLICT (bucket) DO UPDATE SET
           failures = CASE WHEN window_start > ? THEN failures + 1 ELSE 1 END,
           window_start = CASE WHEN window_start > ? THEN window_start ELSE excluded.window_start END`,
      )
      .bind(bucket, now, now - windowMs, now - windowMs)
      .run();
  }

  async clearFailures(bucket: string): Promise<void> {
    await this.db.prepare("DELETE FROM login_attempts WHERE bucket = ?").bind(bucket).run();
  }

  private async all<T>(sql: string): Promise<T[]> {
    return (await this.db.prepare(sql).all<T>()).results;
  }
}
