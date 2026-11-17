import type { Child } from "hono/jsx";
import type { AccountRow, FeedRow } from "../db/store";
import type { Provider, ShowSummary } from "../providers/types";

export function Page(props: { title: string; children: Child; signedIn?: boolean }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title} · Podcast Proxy</title>
        <link rel="stylesheet" href="/app.css" />
        <script src="/app.js" defer></script>
      </head>
      <body>
        <header class="top">
          <a class="brand" href="/">Podcast Proxy</a>
          {props.signedIn && (
            <form method="post" action="/logout">
              <button class="link">Sign out</button>
            </form>
          )}
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

export function SetupNeeded(props: { missing: string[] }) {
  return (
    <Page title="Setup needed">
      <h1>Almost there</h1>
      <p>This Worker is missing {props.missing.length === 1 ? "a secret" : "some secrets"} it needs before it can start:</p>
      <ul>
        {props.missing.map((m) => (
          <li>
            <code>{m}</code>
          </li>
        ))}
      </ul>
      <p>
        Deploy with <code>pnpm run deploy</code>, which creates <code>APP_SECRET</code> for you, or add them in the Cloudflare dashboard under your
        Worker's <strong>Settings → Variables and Secrets</strong>. <code>APP_SECRET</code> must be 64 hex characters (<code>openssl rand -hex 32</code>).
      </p>
    </Page>
  );
}

export function Login(props: { error?: string }) {
  return (
    <Page title="Sign in">
      <form method="post" action="/login" class="card narrow">
        <h1>Sign in</h1>
        {props.error && <p class="error">{props.error}</p>}
        <label>
          Admin password
          <input type="password" name="password" autocomplete="current-password" required autofocus />
        </label>
        <button>Sign in</button>
      </form>
    </Page>
  );
}

export function Dashboard(props: {
  accounts: AccountRow[];
  feeds: { feed: FeedRow; url: string; episodes: number }[];
  providers: Provider[];
  notice?: string;
}) {
  const accountName = (id: number) => props.accounts.find((a) => a.id === id)?.label ?? "";
  return (
    <Page title="Feeds" signedIn>
      {props.notice && <p class="notice">{props.notice}</p>}
      <section>
        <h1>Feeds</h1>
        {props.feeds.length === 0 ? (
          <p class="muted">No feeds yet. Add an account below, then pick the shows you want.</p>
        ) : (
          <ul class="feeds">
            {props.feeds.map(({ feed, url, episodes }) => (
              <li class="card feed">
                {feed.image_url ? <img src={feed.image_url} alt="" width={72} height={72} loading="lazy" /> : <div class="art" />}
                <div class="feed-body">
                  <h2>
                    {feed.title} {!feed.enabled && <span class="badge">Paused</span>}
                  </h2>
                  <p class="muted">
                    {accountName(feed.account_id)} · {episodes} episode{episodes === 1 ? "" : "s"} ·{" "}
                    {feed.last_refreshed_at ? <>checked <time datetime={new Date(feed.last_refreshed_at).toISOString()}>{new Date(feed.last_refreshed_at).toISOString()}</time></> : "not checked yet"}
                  </p>
                  {feed.last_error && <p class="error">{feed.last_error}</p>}
                  <div class="copy">
                    <input type="text" readonly value={url} aria-label={`Feed address for ${feed.title}`} />
                    <button type="button" data-copy={url}>
                      Copy
                    </button>
                  </div>
                  <div class="actions">
                    <PostButton action={`/feeds/${feed.id}/refresh`} label="Check now" />
                    <PostButton action={`/feeds/${feed.id}/toggle`} label={feed.enabled ? "Pause" : "Resume"} />
                    <PostButton action={`/feeds/${feed.id}/rotate`} label="New address" confirm="The current address stops working, and you'll need to follow the show again with the new one." />
                    <PostButton action={`/feeds/${feed.id}/delete`} label="Delete" confirm={`Delete the feed for ${feed.title}?`} danger />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {props.feeds.length > 0 && (
          <p class="muted small">
            In Apple Podcasts: Library → ⋯ → <strong>Follow a Show by URL</strong> (on a Mac: File → Follow a Show by URL), then paste the address. Keep these
            addresses to yourself: anyone who has one can listen.
          </p>
        )}
      </section>

      <section>
        <h1>Accounts</h1>
        {props.accounts.length > 0 && (
          <ul class="accounts">
            {props.accounts.map((a) => (
              <li class="card">
                <div>
                  <strong>{a.label}</strong> <span class="muted">· {props.providers.find((p) => p.id === a.provider)?.name ?? a.provider}</span>
                  {a.last_error && <p class="error">{a.last_error}</p>}
                </div>
                <div class="actions">
                  <a class="button" href={`/accounts/${a.id}/shows`}>
                    Shows
                  </a>
                  <a class="button" href={`/accounts/${a.id}/edit`}>
                    Credentials
                  </a>
                  <PostButton action={`/accounts/${a.id}/delete`} label="Delete" confirm={`Delete ${a.label} and all its feeds?`} danger />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p>
          Add an account:{" "}
          {props.providers.map((p) => (
            <a class="button" href={`/accounts/new?provider=${p.id}`}>
              {p.name}
            </a>
          ))}
        </p>
      </section>
    </Page>
  );
}

export function AccountForm(props: { provider: Provider; action: string; label?: string; error?: string; editing?: boolean }) {
  return (
    <Page title={`${props.provider.name} account`} signedIn>
      <form method="post" action={props.action} class="card narrow">
        <h1>
          {props.editing ? "Update" : "Add"} your {props.provider.name} account
        </h1>
        {props.error && <p class="error">{props.error}</p>}
        <label>
          Name
          <input type="text" name="label" value={props.label ?? props.provider.name} required maxlength={80} />
        </label>
        {props.provider.credentialFields.map((f) => (
          <label>
            {f.label}
            <input type={f.type} name={`cred_${f.name}`} autocomplete={f.autocomplete} required />
          </label>
        ))}
        <p class="muted small">
          The Worker signs in to check these, then keeps them encrypted in your Cloudflare D1 database with a key only this Worker holds. They're never shown
          again.
        </p>
        <button>{props.editing ? "Save" : "Sign in and continue"}</button>
        <a class="button link" href="/">
          Cancel
        </a>
      </form>
    </Page>
  );
}

export function ShowPicker(props: { account: AccountRow; provider: Provider; shows: ShowSummary[]; followed: Set<string>; error?: string }) {
  return (
    <Page title="Pick shows" signedIn>
      <form method="post" action={`/accounts/${props.account.id}/shows`} class="card">
        <h1>Shows from {props.provider.name}</h1>
        {props.error && <p class="error">{props.error}</p>}
        <p class="muted">Pick the shows to make feeds for. Shows you already follow are ticked.</p>
        <ul class="picker">
          {props.shows.map((s) => (
            <li>
              <label class="check">
                <input type="checkbox" name="show" value={`${s.slug}\n${s.title}`} checked={props.followed.has(s.slug)} disabled={props.followed.has(s.slug)} />
                {s.title}
              </label>
            </li>
          ))}
        </ul>
        <button>Make feeds</button>
        <a class="button link" href="/">
          Back
        </a>
      </form>
    </Page>
  );
}

export function ErrorPage(props: { status: number; message: string; signedIn?: boolean }) {
  return (
    <Page title="Error" signedIn={props.signedIn}>
      <h1>{props.status === 404 ? "Not found" : "Something went wrong"}</h1>
      <p>{props.message}</p>
      <p>
        <a href="/">Back</a>
      </p>
    </Page>
  );
}

function PostButton(props: { action: string; label: string; confirm?: string; danger?: boolean }) {
  return (
    <form method="post" action={props.action} data-confirm={props.confirm}>
      <button class={props.danger ? "danger" : "secondary"}>{props.label}</button>
    </form>
  );
}
