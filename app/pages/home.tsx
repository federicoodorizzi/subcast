import { useEffect, useState } from "react";
import { CircleAlertIcon, EllipsisIcon, LogOutIcon, PlusIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import type { FeedInfo } from "../../src/api-types";
import { Artwork, CopyButton, Screen } from "@/components/shell";
import { FeedSheet } from "@/components/feed-sheet";
import { ProviderIcon } from "@/components/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { plural, timeAgo } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { useAppState } from "@/lib/state";
import { cn } from "@/lib/utils";

export function HomeScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { state, reload } = useAppState();
  const [openId, setOpenId] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  // Opening a show's sheet puts it in the address, so Back closes it.
  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get("show"));
    if (id) setOpenId(id);
  }, []);
  const open = (id: number | null) => {
    setOpenId(id);
    history.replaceState(null, "", id ? `/?show=${id}` : "/");
  };

  const accounts = state?.accounts ?? [];
  const feeds = state?.feeds ?? [];
  const openFeed = feeds.find((f) => f.id === openId) ?? null;
  // With more than one publisher, each row says whose show it is.
  const providerNames = new Map(accounts.map((a) => [a.id, state?.providers.find((p) => p.id === a.provider)?.name ?? a.provider]));
  if (new Set(providerNames.values()).size < 2) providerNames.clear();
  const needsAttention = feeds.filter((f) => f.lastError).length + accounts.filter((a) => a.lastError).length;

  const addShows = () => {
    if (accounts.length === 1) navigate(`/accounts/${accounts[0]!.id}/shows`);
    else navigate("/accounts");
  };

  async function checkAll() {
    setChecking(true);
    const results = await Promise.allSettled(feeds.filter((f) => f.enabled).map((f) => api.refresh(f.id)));
    const fresh = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.newEpisodes : 0), 0);
    const failed = results.filter((r) => r.status === "rejected" || r.value.error).length;
    await reload();
    setChecking(false);
    if (failed) toast.error(`${plural(failed, "show")} couldn't be checked`);
    else toast.success(fresh ? `${plural(fresh, "new episode")}` : "Everything's up to date");
  }

  return (
    <Screen
      title="Your shows"
      actions={
        <>
          {feeds.length > 0 && (
            <Button size="sm" className="h-9" onClick={addShows}>
              <PlusIcon />
              Add shows
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9" aria-label="More">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={checkAll} disabled={checking || feeds.length === 0}>
                <RefreshCwIcon className={cn(checking && "animate-spin")} />
                Check all for new episodes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/accounts")}>
                <UsersIcon />
                Accounts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await api.logout();
                  onSignedOut();
                }}
              >
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {!state ? (
        <FeedListSkeleton />
      ) : feeds.length === 0 ? (
        <Empty className="mt-10 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlusIcon />
            </EmptyMedia>
            <EmptyTitle>{accounts.length ? "Pick your first shows" : "Connect a subscription"}</EmptyTitle>
            <EmptyDescription>
              {accounts.length
                ? "Choose the shows you want, and each one gets a private feed address for your podcast app."
                : "Sign in to a publisher you subscribe to, pick its shows, and each one gets a private feed for Apple Podcasts."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {accounts.length ? (
              <Button size="lg" className="h-11" onClick={addShows}>
                Choose shows
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {state.providers.map((p) => (
                  <Button key={p.id} variant="outline" size="lg" className="h-11 gap-2 pl-1.5" asChild>
                    <Link href={`/accounts/new/${p.id}`}>
                      <ProviderIcon provider={p} className="size-8 rounded-md" />
                      Connect {p.name}
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {needsAttention > 0 && (
            <button
              type="button"
              onClick={() => {
                const broken = feeds.find((f) => f.lastError);
                if (broken) open(broken.id);
                else navigate("/accounts");
              }}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-left text-sm text-destructive"
            >
              <CircleAlertIcon className="size-4 shrink-0" />
              {plural(needsAttention, "thing needs", "things need")} your attention
            </button>
          )}
          <ul className="flex flex-col gap-2">
            {feeds.map((f) => (
              <FeedRow key={f.id} feed={f} onOpen={() => open(f.id)} publisher={providerNames.size > 1 ? providerNames.get(f.accountId) : undefined} />
            ))}
          </ul>
          <p className="mt-6 px-1 text-center text-xs text-muted-foreground">
            New episodes are checked every 30 minutes. Tap a show to add it to your podcast app.
          </p>
        </>
      )}
      <FeedSheet feed={openFeed} onClose={() => open(null)} />
    </Screen>
  );
}

function FeedRow({ feed, onOpen, publisher }: { feed: FeedInfo; onOpen: () => void; publisher?: string }) {
  return (
    <li className={cn("group relative flex items-center gap-3 rounded-xl border bg-card p-2.5 pr-2 transition-colors hover:bg-muted/50", !feed.enabled && "opacity-60")}>
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Open ${feed.title}`} />
      <Artwork src={feed.imageUrl} className="size-14" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-medium">{feed.title}</p>
          {!feed.enabled && <Badge variant="secondary">Paused</Badge>}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {feed.lastError ? (
            <span className="text-destructive">Couldn't check · tap for details</span>
          ) : feed.latestEpisodeAt ? (
            <>
              {publisher && `${publisher} · `}
              {plural(feed.episodes, "episode")} · latest {timeAgo(feed.latestEpisodeAt)}
            </>
          ) : (
            "No episodes yet"
          )}
        </p>
      </div>
      <CopyButton text={feed.url} variant="ghost" className="relative z-10 text-muted-foreground" />
    </li>
  );
}

function FeedListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border p-2.5">
          <Skeleton className="size-14 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

