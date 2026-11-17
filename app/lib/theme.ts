import { useSyncExternalStore } from "react";

// The app follows the system's light or dark setting, live.
const query = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function apply() {
  document.documentElement.classList.toggle("dark", !!query?.matches);
}

export function initTheme() {
  apply();
  query?.addEventListener("change", apply);
}

export function useSystemTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener("change", cb);
      return () => query?.removeEventListener("change", cb);
    },
    () => (query?.matches ? "dark" : "light"),
  );
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
  );
}
