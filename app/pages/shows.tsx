import { useEffect, useMemo, useState } from "react";
import { CheckIcon, CircleAlertIcon, SearchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { ShowChoice } from "../../src/api-types";
import { Artwork, Screen, SectionTitle } from "@/components/shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useAppState } from "@/lib/state";
import { cn } from "@/lib/utils";

type Progress = Record<string, "adding" | "done" | { error: string }>;

export function ShowsScreen({ accountId }: { accountId: number }) {
  const { state, reload } = useAppState();
  const account = state?.accounts.find((a) => a.id === accountId);
  const provider = state?.providers.find((p) => p.id === account?.provider);
  const [shows, setShows] = useState<ShowChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<Progress>({});
  const adding = Object.values(progress).includes("adding");
  const finished = Object.keys(progress).length > 0 && !adding;

  useEffect(() => {
    api.shows(accountId).then(setShows, (err: Error) => setLoadError(err.message));
  }, [accountId]);

  const q = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => (shows ?? []).filter((s) => !q || s.title.toLocaleLowerCase().includes(q)), [shows, q]);
  const available = visible.filter((s) => s.feedId === null);
  const followed = visible.filter((s) => s.feedId !== null);
  const allPicked = available.length > 0 && available.every((s) => picked.has(s.slug));

  function toggle(slug: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  async function addPicked() {
    const list = (shows ?? []).filter((s) => picked.has(s.slug));
    setProgress(Object.fromEntries(list.map((s) => [s.slug, "adding" as const])));
    let failed = 0;
    // One at a time: each is a sign-in check and a page fetch at the publisher, so stay polite.
    for (const s of list) {
      try {
        const r = await api.addFeed(accountId, s.slug, s.title);
        if (r.error) failed++;
        setProgress((p) => ({ ...p, [s.slug]: r.error ? { error: r.error } : "done" }));
      } catch (err) {
        failed++;
        setProgress((p) => ({ ...p, [s.slug]: { error: err instanceof Error ? err.message : String(err) } }));
      }
    }
    await reload();
    if (failed === 0) {
      toast.success(`${plural(list.length, "show")} added`);
      navigate("/", { replace: true });
    } else {
      toast.error(`${plural(failed, "show")} couldn't be checked yet. They'll be retried every 30 minutes.`);
    }
  }

  const footer =
    shows && shows.length > 0 ? (
      finished ? (
        <Button size="lg" className="h-12 w-full text-base" onClick={() => navigate("/", { replace: true })}>
          Done
        </Button>
      ) : (
        <Button size="lg" className="h-12 w-full text-base" disabled={picked.size === 0 || adding} onClick={addPicked}>
          {adding ? (
            <>
              <Spinner /> Adding {Object.values(progress).filter((v) => v !== "adding").length + 1} of {Object.keys(progress).length}…
            </>
          ) : picked.size === 0 ? (
            "Tick the shows you want"
          ) : (
            `Add ${plural(picked.size, "show")}`
          )}
        </Button>
      )
    ) : undefined;

  return (
    <Screen title={provider ? `${provider.name} shows` : "Shows"} back="/" footer={footer}>
      {loadError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn't load the shows</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : !shows ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder={`Search ${plural(shows.length, "show")}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="text-base md:text-sm"
              enterKeyHint="search"
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <SectionTitle
            action={
              available.length > 0 &&
              !finished && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  disabled={adding}
                  onClick={() => setPicked((prev) => {
                    const next = new Set(prev);
                    for (const s of available) allPicked ? next.delete(s.slug) : next.add(s.slug);
                    return next;
                  })}
                >
                  {allPicked ? "Clear" : "Select all"}
                </Button>
              )
            }
          >
            {available.length ? "Available" : q ? "No matches" : "You follow every show"}
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {available.map((s) => (
              <ShowRow key={s.slug} show={s} checked={picked.has(s.slug)} onChange={(on) => toggle(s.slug, on)} status={progress[s.slug]} disabled={adding || finished} />
            ))}
          </ul>

          {followed.length > 0 && (
            <>
              <SectionTitle>Following</SectionTitle>
              <ul className="flex flex-col gap-2">
                {followed.map((s) => (
                  <li key={s.slug} className="flex min-h-16 items-center gap-3 rounded-xl border border-dashed p-2.5 text-muted-foreground">
                    <Artwork src={s.imageUrl} className="size-11" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <Badge variant="secondary">
                      <CheckIcon /> Following
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function ShowRow(props: { show: ShowChoice; checked: boolean; onChange: (on: boolean) => void; status?: Progress[string]; disabled: boolean }) {
  const { show, checked, status } = props;
  const id = `show-${show.slug}`;
  const error = typeof status === "object" ? status.error : null;
  return (
    <li>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border bg-card p-2.5 transition-colors select-none active:bg-muted",
          checked && "border-primary/50 bg-primary/[0.04] dark:bg-primary/[0.08]",
          props.disabled && "cursor-default",
        )}
      >
        <Artwork src={show.imageUrl} className="size-11" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{show.title}</span>
          {error && <span className="block truncate text-xs text-destructive">{error}</span>}
        </span>
        {status === "adding" ? (
          <Spinner className="size-5" />
        ) : status === "done" ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-3.5" />
          </span>
        ) : error ? (
          <CircleAlertIcon className="size-5 text-destructive" />
        ) : (
          <Checkbox id={id} checked={checked} disabled={props.disabled} onCheckedChange={(v) => props.onChange(v === true)} className="size-5" />
        )}
      </label>
    </li>
  );
}
