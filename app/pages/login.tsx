import { useState } from "react";
import { EyeIcon, EyeOffIcon, TriangleAlertIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <Logo className="size-9" />
        Subcast
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Card>
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Enter the admin password you chose when you deployed.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="password">Admin password</FieldLabel>
                <InputGroup className="h-11">
                  <InputGroupInput
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    autoFocus
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error}
                    className="text-base md:text-sm"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                      {show ? <EyeOffIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {error && <FieldError>{error}</FieldError>}
              </Field>
              <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || !password}>
                {busy && <Spinner />}
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </Centered>
  );
}

export function SetupScreen({ missing }: { missing: string[] }) {
  return (
    <Centered>
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Almost there</AlertTitle>
        <AlertDescription>
          <p>
            This Worker still needs {missing.length === 1 ? "the secret" : "the secrets"}{" "}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && " and "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{m}</code>
              </span>
            ))}
            .
          </p>
          <p>
            Deploy with <code className="font-mono text-xs">pnpm run deploy</code>, which creates <code className="font-mono text-xs">APP_SECRET</code> for you, or add
            them in the Cloudflare dashboard under your Worker's <strong>Settings → Variables and Secrets</strong>. <code className="font-mono text-xs">APP_SECRET</code> must
            be 64 hex characters (<code className="font-mono text-xs">openssl rand -hex 32</code>).
          </p>
        </AlertDescription>
      </Alert>
    </Centered>
  );
}
