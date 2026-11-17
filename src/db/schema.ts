// The Worker creates and upgrades its own tables, so a deploy from the button, from wrangler or from
// CI needs no migration step. Each entry runs once, in order; never edit one that has shipped, add one.

const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      credentials_sealed TEXT NOT NULL,
      session_sealed TEXT,
      session_expires_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      show_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description_html TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_sealed TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_refreshed_at INTEGER,
      last_error TEXT,
      last_error_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (account_id, show_slug)
    )`,
    `CREATE TABLE episodes (
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      description_html TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      duration_seconds INTEGER,
      audio_url TEXT NOT NULL,
      audio_type TEXT NOT NULL,
      link TEXT,
      first_seen_at INTEGER NOT NULL,
      PRIMARY KEY (feed_id, guid)
    )`,
    `CREATE INDEX episodes_by_date ON episodes (feed_id, published_at DESC)`,
    `CREATE TABLE login_attempts (
      bucket TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    )`,
  ],
];

let ready: Promise<void> | null = null;

/** Brings the database up to date, once per isolate. */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

async function migrate(db: D1Database): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)").run();
  const row = await db.prepare("SELECT MAX(version) AS v FROM schema_version").first<{ v: number | null }>();
  for (let v = (row?.v ?? 0) + 1; v <= MIGRATIONS.length; v++) {
    // One batch per migration is one transaction: a failure leaves the database at the version before it.
    await db.batch([...MIGRATIONS[v - 1]!.map((sql) => db.prepare(sql)), db.prepare("INSERT INTO schema_version (version) VALUES (?)").bind(v)]);
  }
}
