import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, PodcastIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Logo } from "@/components/logo";
import { Link } from "@/lib/router";
import { useMediaQuery } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The frame of every signed-in screen: a sticky bar with the title and its actions, then the content. */
export function Screen(props: { title: ReactNode; back?: string; actions?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-lg supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-2 px-4">
          {props.back ? (
            <Button variant="ghost" size="sm" className="-ml-2 h-9 px-2 text-muted-foreground" asChild>
              <Link href={props.back}>‹ Back</Link>
            </Button>
          ) : (
            <Link href="/" className="-ml-1 flex items-center gap-2 font-semibold tracking-tight" aria-label="Subcast">
              <Logo />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{props.title}</h1>
          <div className="flex items-center gap-1">{props.actions}</div>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]", props.footer && "pb-32")}>
        {props.children}
      </main>
      {props.footer && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/85 backdrop-blur-lg">
          <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{props.footer}</div>
        </div>
      )}
    </div>
  );
}

/** Show artwork, with a plain tile while there's none. */
export function Artwork({ src, alt = "", className }: { src: string | null | undefined; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-black/5 dark:ring-white/10", className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <PodcastIcon className="size-1/2 max-h-6 max-w-6" />
        </div>
      )}
    </div>
  );
}

export async function copyText(text: string, what = "Address") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error("Couldn't copy. Select the address and copy it yourself.");
    return false;
  }
}

export function CopyButton({ text, label, className, variant = "outline" }: { text: string; label?: string; className?: string; variant?: "outline" | "default" | "ghost" | "secondary" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={label ? "lg" : "icon"}
      className={cn(!label && "size-9", className)}
      aria-label={label ?? "Copy address"}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {label}
    </Button>
  );
}

/** A bottom sheet on phones, a dialog on wider screens. */
export function Sheet(props: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  if (desktop) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description && <DialogDescription>{props.description}</DialogDescription>}
          </DialogHeader>
          {props.children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle>{props.title}</DrawerTitle>
          {props.description && <DrawerDescription>{props.description}</DrawerDescription>}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">{props.children}</div>
      </DrawerContent>
    </Drawer>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-8 mb-2 flex items-center justify-between px-1 first:mt-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>
      {action}
    </div>
  );
}
