import { useEffect, useState } from "react";
import { CircleAlertIcon, ExternalLinkIcon, KeyRoundIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { EpisodeInfo, FeedInfo } from "../../src/api-types";
import { Artwork, CopyButton, Sheet } from "@/components/shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { duration, plural, shortDate, timeAgo } from "@/lib/format";
import { useAppState } from "@/lib/state";

/** Apple Podcasts opens its Follow a Show sheet for podcast:// links, the address prefilled. */
const appleLink = (url: string) => url.replace(/^https:\/\//, "podcast://");
const overcastLink = (url: string) => `overcast://x-callback-url/add?url=${encodeURIComponent(url)}`;

export function FeedSheet({ feed, onClose }: { feed: FeedInfo | null; onClose: () => void }) {
  // Keep the last feed while the sheet animates closed.
  const [shown, setShown] = useState<FeedInfo | null>(feed);
  useEffect(() => {
    if (feed) setShown(feed);
  }, [feed]);
  const f = feed ?? shown;
  return (
    <Sheet open={!!feed} onOpenChange={(o) => !o && onClose()} title={f?.title ?? ""} description={f ? f.author || undefined : undefined}>
      {f && <FeedDetails key={f.id} feed={f} onDeleted={onClose} />}
    </Sheet>
  );
}

function FeedDetails({ feed, onDeleted }: { feed: FeedInfo; onDeleted: () => void }) {
  const { reload } = useAppState();
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [busy, setBusy] = useState<null | "refresh" | "toggle" | "rotate" | "delete">(null);
  const [confirm, setConfirm] = useState<null | "rotate" | "delete">(null);

  useEffect(() => {
    api.episodes(feed.id).then(setEpisodes, () => setEpisodes([]));
  }, [feed.id, feed.lastRefreshedAt]);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string | void>) {
    setBusy(kind);
    try {
      const msg = await fn();
      await reload();
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Artwork src={feed.imageUrl} className="size-20 md:size-24" />
        <div className="min-w-0 text-sm text-muted-foreground">
          <p>{plural(feed.episodes, "episode")}</p>
          <p>Checked {timeAgo(feed.lastRefreshedAt)}</p>
          {feed.link && (
            <a href={feed.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Publisher's page <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>

      {feed.lastError && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The last check failed</AlertTitle>
          <AlertDescription className="break-words">{feed.lastError}</AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Add to your podcast app</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button size="lg" className="h-11" asChild>
            <a href={appleLink(feed.url)}>Open in Apple Podcasts</a>
          </Button>
          <CopyButton text={feed.url} label="Copy address" className="h-11" />
        </div>
        <InputGroup className="h-10">
          <InputGroupInput readOnly value={feed.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Feed address" />
          <InputGroupAddon align="inline-end">
            <a href={overcastLink(feed.url)} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Overcast
            </a>
          </InputGroupAddon>
        </InputGroup>
        <p className="text-xs text-muted-foreground">
          If the button does nothing: in Apple Podcasts go to Library → ⋯ → <strong>Follow a Show by URL</strong> (on a Mac, File → Follow a Show by URL) and paste the
          address. Keep it private: anyone who has it can listen.
        </p>
      </section>

      <Separator />

      <section className="flex flex-col gap-1">
        <h3 className="mb-1 text-sm font-medium">Latest episodes</h3>
        {!episodes ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="my-1 h-9" />)
        ) : episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y">
            {episodes.slice(0, 6).map((e) => (
              <li key={e.guid} className="py-2">
                <p className="line-clamp-2 text-sm">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {shortDate(e.publishedAt)}
                  {e.durationSeconds ? ` · ${duration(e.durationSeconds)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Check for new episodes</span>
            <span className="block text-xs text-muted-foreground">Paused feeds keep their episodes but get no new ones.</span>
          </span>
          <Switch
            checked={feed.enabled}
            disabled={busy === "toggle"}
            onCheckedChange={(v) => run("toggle", async () => (await api.setEnabled(feed.id, v), v ? "Resumed" : "Paused"))}
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            variant="outline"
            size="lg"
            className="h-11"
            disabled={!!busy}
            onClick={() =>
              run("refresh", async () => {
                const r = await api.refresh(feed.id);
                if (r.error) throw new Error(r.error);
                return r.newEpisodes ? plural(r.newEpisodes, "new episode") : "No new episodes";
              })
            }
          >
            {busy === "refresh" ? <Spinner /> : <RefreshCwIcon />}
            Check now
          </Button>
          <Button variant="outline" size="lg" className="h-11" disabled={!!busy} onClick={() => setConfirm("rotate")}>
            <KeyRoundIcon />
            New address
          </Button>
          <Button variant="destructive" size="lg" className="h-11" disabled={!!busy} onClick={() => setConfirm("delete")}>
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </section>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `Delete ${feed.title}?` : "Give this feed a new address?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "Its address stops working and its saved episodes are removed. You can add the show again later."
                : "The current address stops working at once. Do this if it leaked, then follow the show again in your podcast app with the new one."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "destructive" : "default"}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "delete")
                  void run("delete", async () => {
                    await api.deleteFeed(feed.id);
                    onDeleted();
                    return `${feed.title} deleted`;
                  });
                else void run("rotate", async () => (await api.rotate(feed.id), "New address ready. Follow the show again with it."));
              }}
            >
              {busy === "delete" || busy === "rotate" ? <Spinner /> : null}
              {confirm === "delete" ? "Delete" : "New address"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
