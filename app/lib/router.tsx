import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A few screens don't need a router library: the path lives in history, and links push to it.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.scrollTo(0, 0);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

/** Matches "/accounts/:id/shows" against a path, returning the params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const a = path.replace(/\/+$/, "").split("/");
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(a[i]!);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
}
