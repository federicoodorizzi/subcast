import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { State } from "../../src/api-types";
import { api } from "./api";

interface AppState {
  state: State | null;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<AppState>({ state: null, error: null, reload: async () => {} });

/** Loads everything the screens show in one request, and reloads it after each change. */
export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
    // Pick up the cron's work when the app comes back to the foreground.
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);
  return <Ctx.Provider value={{ state, error, reload }}>{children}</Ctx.Provider>;
}

export const useAppState = () => useContext(Ctx);
