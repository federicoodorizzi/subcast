import { useState } from "react";
import { CircleAlertIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { ProviderInfo } from "../../src/api-types";
import { Screen, SectionTitle } from "@/components/shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { useAppState } from "@/lib/state";

export function AccountsScreen() {
  const { state, reload } = useAppState();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const target = state?.accounts.find((a) => a.id === deleting);

  return (
    <Screen title="Accounts" back="/">
      {!state ? (
        <Skeleton className="h-20" />
      ) : (
        <>
          {state.accounts.length > 0 && (
            <>
              <SectionTitle>Connected</SectionTitle>
              <ul className="flex flex-col gap-2">
                {state.accounts.map((a) => {
                  const provider = state.providers.find((p) => p.id === a.provider);
                  const feeds = state.feeds.filter((f) => f.accountId === a.id).length;
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                      <ProviderMark name={provider?.name ?? a.provider} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.label}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {a.lastError ? <span className="text-destructive">{a.lastError}</span> : `${provider?.name ?? a.provider} · ${plural(feeds, "show")}`}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="h-9" asChild>
                        <Link href={`/accounts/${a.id}/shows`}>Shows</Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-9" aria-label={`More for ${a.label}`}>
                            <EllipsisVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => navigate(`/accounts/${a.id}/edit`)}>
                            <PencilIcon /> Update sign-in
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(a.id)}>
                            <Trash2Icon /> Remove account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <SectionTitle>Connect a publisher</SectionTitle>
          <ul className="flex flex-col gap-2">
            {state.providers.map((p) => (
              <li key={p.id}>
                <Link href={`/accounts/new/${p.id}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-dashed p-3 transition-colors hover:bg-muted/50 active:bg-muted">
                  <ProviderMark name={p.name} />
                  <span className="flex-1 font-medium">{p.name}</span>
                  <PlusIcon className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 px-1 text-xs text-muted-foreground">More publishers are on the way.</p>
        </>
      )}

      <AlertDialog open={!!target} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {target?.label}?</AlertDialogTitle>
            <AlertDialogDescription>Its saved sign-in and all its feeds are deleted, and their addresses stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async (e) => {
                e.preventDefault();
                if (!target) return;
                setBusy(true);
                try {
                  await api.deleteAccount(target.id);
                  await reload();
                  toast.success(`${target.label} removed`);
                  setDeleting(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}

function ProviderMark({ name }: { name: string }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground" aria-hidden>
      {name.slice(0, 1)}
    </span>
  );
}

/** Connects a new account (`providerId`), or updates the sign-in of an existing one (`accountId`). */
export function AccountFormScreen({ providerId, accountId }: { providerId?: string; accountId?: number }) {
  const { state, reload } = useAppState();
  const account = accountId ? state?.accounts.find((a) => a.id === accountId) : undefined;
  const provider: ProviderInfo | undefined = state?.providers.find((p) => p.id === (providerId ?? account?.provider));
  const [label, setLabel] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state) return <Screen title="" back="/accounts"><Skeleton className="h-64" /></Screen>;
  if (!provider || (accountId && !account)) {
    return (
      <Screen title="Not found" back="/accounts">
        <p className="text-muted-foreground">There's no such account.</p>
      </Screen>
    );
  }

  const name = label ?? account?.label ?? provider.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      if (account) {
        await api.updateAccount(account.id, { label: name, credentials: values });
        await reload();
        toast.success("Sign-in updated");
        navigate("/accounts", { replace: true });
      } else {
        const created = await api.addAccount(provider.id, name, values);
        await reload();
        toast.success(`Signed in to ${provider.name}`);
        navigate(`/accounts/${created.id}/shows`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Screen title={account ? "Update sign-in" : `Connect ${provider.name}`} back="/accounts">
      <form onSubmit={submit} className="mx-auto max-w-md">
        <p className="mb-5 text-sm text-muted-foreground">
          {account
            ? `Enter your ${provider.name} sign-in again. It's checked before it's saved.`
            : `Sign in with the ${provider.name} account that has your subscription. Next, you'll pick the shows you want.`}
        </p>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {provider.credentialFields.map((f) => (
            <Field key={f.name}>
              <FieldLabel htmlFor={`cred-${f.name}`}>{f.label}</FieldLabel>
              {f.type === "password" ? (
                <InputGroup className="h-11">
                  <InputGroupInput
                    id={`cred-${f.name}`}
                    type={reveal ? "text" : "password"}
                    autoComplete={f.autocomplete}
                    required
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    className="text-base md:text-sm"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide password" : "Show password"}>
                      {reveal ? <EyeOffIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <Input
                  id={`cred-${f.name}`}
                  type={f.type}
                  autoComplete={f.autocomplete}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode={f.type === "email" ? "email" : undefined}
                  required
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  className="h-11 text-base md:text-sm"
                />
              )}
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="label">Name</FieldLabel>
            <Input id="label" value={name} onChange={(e) => setLabel(e.target.value)} maxLength={80} required className="h-11 text-base md:text-sm" />
            <FieldDescription>Only shown here, to tell accounts apart.</FieldDescription>
          </Field>
          {error && <FieldError className="sr-only">{error}</FieldError>}
          <div className="flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            <p>Your password is encrypted before it's stored, in your own Cloudflare account, with a key only this Worker holds. It's never shown again.</p>
          </div>
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
            {busy && <Spinner />}
            {busy ? "Signing in…" : account ? "Save" : "Sign in and continue"}
          </Button>
        </FieldGroup>
      </form>
    </Screen>
  );
}
