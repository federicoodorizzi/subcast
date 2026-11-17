import { useState } from "react";
import type { ProviderInfo } from "../../src/api-types";
import { cn } from "@/lib/utils";

/** A publisher's icon from its own site, or its initial while there's none. */
export function ProviderIcon({ provider, name, className }: { provider?: ProviderInfo; name?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const label = provider?.name ?? name ?? "?";
  return (
    <span
      className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm font-semibold text-muted-foreground ring-1 ring-black/5 dark:ring-white/10", className)}
      aria-hidden
    >
      {provider?.iconUrl && !failed ? (
        <img src={provider.iconUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        label.slice(0, 1)
      )}
    </span>
  );
}
