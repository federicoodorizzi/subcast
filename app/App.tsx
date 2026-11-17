import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "../src/api-types";
import { Spinner } from "@/components/ui/spinner";
import { api, setSignedOutHandler } from "@/lib/api";
import { match, usePath } from "@/lib/router";
import { StateProvider } from "@/lib/state";
import { AccountFormScreen, AccountsScreen } from "@/pages/accounts";
import { HomeScreen } from "@/pages/home";
import { LoginScreen, SetupScreen } from "@/pages/login";
import { ShowsScreen } from "@/pages/shows";

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const check = useCallback(() => api.session().then(setSession, () => setSession({ setupMissing: [], signedIn: false })), []);
  useEffect(() => {
    void check();
    setSignedOutHandler(() => setSession((s) => (s ? { ...s, signedIn: false } : s)));
  }, [check]);

  if (!session)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  if (session.setupMissing.length) return <SetupScreen missing={session.setupMissing} />;
  if (!session.signedIn) return <LoginScreen onSignedIn={check} />;
  return (
    <StateProvider>
      <Routes onSignedOut={() => setSession({ ...session, signedIn: false })} />
    </StateProvider>
  );
}

function Routes({ onSignedOut }: { onSignedOut: () => void }) {
  const path = usePath();
  let m: Record<string, string> | null;
  if ((m = match("/accounts/:id/shows", path))) return <ShowsScreen key={m.id} accountId={Number(m.id)} />;
  if ((m = match("/accounts/:id/edit", path))) return <AccountFormScreen key={m.id} accountId={Number(m.id)} />;
  if ((m = match("/accounts/new/:provider", path))) return <AccountFormScreen key={m.provider} providerId={m.provider} />;
  if (match("/accounts", path)) return <AccountsScreen />;
  return <HomeScreen onSignedOut={onSignedOut} />;
}
