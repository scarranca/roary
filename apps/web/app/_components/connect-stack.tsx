"use client";

import { ExternalLinkIcon, LoaderIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { authClient } from "@/lib/auth/client";
import type { Provider, PublicConnection } from "@/lib/connections/types";
import { cn } from "@/lib/utils";
import { AuthDialog } from "./auth-dialog";

type Stack = { signedIn: boolean; githubEnabled?: boolean; connections: Record<Provider, PublicConnection | null> };

const NO_CONNECTIONS = { github: null, sentry: null, posthog: null } as const;

const FIELD =
  "w-full rounded-[3px] border-2 border-ink bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:outline-2 focus-visible:outline-safety";
const BUTTON = "plate inline-flex items-center justify-center gap-2 px-6 py-2.5 font-mono text-xs uppercase disabled:opacity-50";

const PROVIDERS: { id: Provider; name: string; role: string; demo: string }[] = [
  { id: "github", name: "GitHub", role: "Reads code · opens fix PRs · reviews launches", demo: "scarranca/roary-demo-shop" },
  { id: "sentry", name: "Sentry", role: "Watches errors · starts triage", demo: "roary / javascript-nextjs-k4" },
  { id: "posthog", name: "PostHog", role: "Counts who's affected · launch impact", demo: "Project 665339 · US" },
];

/**
 * "Connect your stack": GitHub, Sentry and PostHog cards. Used in /hire and /settings/connections.
 * Guests are never blocked: `onSkip` (the /hire station) moves on with the demo shop.
 */
export function ConnectStack({ notice, onSkip }: { readonly notice?: ReactNode; readonly onSkip?: () => void }) {
  const { data: session } = authClient.useSession();
  const [stack, setStack] = useState<Stack>();
  const [loadError, setLoadError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      const body = (await response.json()) as Partial<Stack> & { error?: string };
      // 401 = guest: they use the demo shop, nothing to load.
      if (response.status === 401) {
        setStack({ signedIn: false, githubEnabled: body.githubEnabled, connections: { ...NO_CONNECTIONS } });
        setLoadError(undefined);
        return;
      }
      if (!response.ok || !body.connections) throw new Error(body.error);
      setStack(body as Stack);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error && error.message ? error.message : "Couldn't load your stack.");
    }
  }, []);

  // Reload after signing in, and when the GitHub install tab hands focus back.
  const userId = session?.user?.id;
  useEffect(() => {
    void userId;
    void load();
  }, [load, userId]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {notice}
      {stack && !stack.signedIn ? (
        <p className="hazard-soft rounded-[3px] border-2 border-ink p-3 font-mono text-xs uppercase leading-relaxed">
          <span className="bg-cotton px-1">
            <AuthDialog
              trigger={
                <button className="text-ink underline" type="button">
                  Sign in
                </button>
              }
            />{" "}
            to connect your own stack — or keep using the demo shop.
          </span>
          {onSkip ? (
            <button className="ml-2 bg-cotton px-1 text-ink underline" onClick={onSkip} type="button">
              Use the demo shop →
            </button>
          ) : null}
        </p>
      ) : null}
      {loadError ? (
        <p className="rounded-[3px] border-2 border-broken bg-broken-soft p-3 font-mono text-broken text-xs uppercase" role="alert">
          {loadError}
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {PROVIDERS.map((provider) => (
          <li key={provider.id}>
            <ProviderCard
              connection={stack?.connections[provider.id] ?? null}
              loading={!stack && !loadError}
              onChange={load}
              provider={provider}
              signedIn={stack?.signedIn ?? false}
              unavailable={provider.id === "github" && stack?.signedIn === true && !stack.githubEnabled && !stack.connections.github}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

type CardStatus = "demo" | "connected" | "pending" | "error" | "none";

function StatusTag({ status }: { readonly status: CardStatus }) {
  const look = {
    demo: ["bg-ok-soft text-ok", "✅ Demo shop"],
    connected: ["bg-ok-soft text-ok", "✅ Connected"],
    pending: ["bg-wait-soft text-wait", "⏳ Waiting on approval"],
    error: ["bg-broken-soft text-broken", "❌ Needs attention"],
    none: ["bg-label text-ink", "❌ Not connected"],
  } as const;
  const [color, label] = look[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center py-1 pr-2.5 pl-4 font-mono text-[11px] uppercase [clip-path:polygon(9px_0,100%_0,100%_100%,9px_100%,0_50%)]",
        color,
      )}
    >
      {label}
    </span>
  );
}

function describe(connection: PublicConnection): string {
  const config = connection.config as Record<string, unknown>;
  if (connection.provider === "github") {
    const repos = (config.repos as string[] | undefined) ?? [];
    if (!config.installationId) return "An org owner has to approve the install on GitHub.";
    return `${repos.length} repo${repos.length === 1 ? "" : "s"}${repos.length ? ` · ${repos.slice(0, 3).join(", ")}${repos.length > 3 ? "…" : ""}` : ""}`;
  }
  if (connection.provider === "sentry") return `${config.org} / ${config.project}`;
  return `Project ${config.projectId} · ${String(config.host).includes("eu.") ? "EU" : "US"} cloud`;
}

function ProviderCard({
  provider,
  connection,
  signedIn,
  loading,
  onChange,
  unavailable = false,
}: {
  readonly provider: (typeof PROVIDERS)[number];
  readonly connection: PublicConnection | null;
  readonly signedIn: boolean;
  readonly loading: boolean;
  /** GitHub connect is behind GITHUB_CONNECT_ENABLED until its ownership check is verified end to end. */
  readonly unavailable?: boolean;
  readonly onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const status: CardStatus = !signedIn ? "demo" : (connection?.status ?? "none") === "none" ? "none" : (connection?.status as CardStatus);

  const test = async () => {
    setTesting(true);
    setResult(undefined);
    try {
      const response = await fetch(`/api/connections/${provider.id}/test`, { method: "POST" });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      setResult(body.ok ? { ok: true, text: "Test passed. Roary can read it." } : { ok: false, text: body.error ?? "Test failed." });
      await onChange();
    } catch {
      setResult({ ok: false, text: "Couldn't run the test." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <article aria-label={`${provider.name} connection`} className="plate flex flex-col gap-3 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="type-display text-3xl">{provider.name}</h3>
          <p className="font-mono text-muted-foreground text-xs uppercase">{provider.role}</p>
        </div>
        {loading ? <LoaderIcon aria-label="Loading" className="size-4 animate-spin" /> : <StatusTag status={status} />}
      </div>

      <p className="font-mono text-sm">
        {!signedIn
          ? provider.demo
          : connection
            ? describe(connection)
            : unavailable
              ? "Coming soon. Until then Roary reads code and opens PRs only on the demo shop's repo."
              : "Not connected yet."}
      </p>

      {signedIn && !unavailable ? (
        <div className="flex flex-wrap gap-2">
          {provider.id === "github" ? (
            <a
              className={cn(BUTTON, "bg-safety text-ink")}
              href="/api/connect/github/install"
              rel="noopener"
              target="_blank"
            >
              {connection?.status === "connected" ? "Change repos" : "Install Roary on your repos"}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : (
            <button
              aria-expanded={open}
              className={cn(BUTTON, open ? "bg-label" : "bg-safety text-ink")}
              onClick={() => setOpen((o) => !o)}
              type="button"
            >
              {open ? "Cancel" : connection ? "Replace key" : "Connect"}
            </button>
          )}
          {connection ? (
            <button className={cn(BUTTON, "bg-card")} disabled={testing} onClick={() => void test()} type="button">
              {testing ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
              Test
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p className={cn("font-mono text-xs uppercase", result.ok ? "text-ok" : "text-broken")} role="status">
          {result.text}
        </p>
      ) : null}

      {open && provider.id === "sentry" ? (
        <SentryForm
          onDone={async () => {
            setOpen(false);
            setResult({ ok: true, text: "Connected. The token is stored encrypted." });
            await onChange();
          }}
        />
      ) : null}
      {open && provider.id === "posthog" ? (
        <PosthogForm
          onDone={async () => {
            setOpen(false);
            setResult({ ok: true, text: "Connected. The key is stored encrypted." });
            await onChange();
          }}
        />
      ) : null}
    </article>
  );
}

function useSubmit(provider: Provider, onDone: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/connections/${provider}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const reply = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(reply.error ?? "That didn't work.");
        return;
      }
      form.reset();
      await onDone();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setPending(false);
    }
  };
  return { pending, error, submit };
}

function Labeled({ label, hint, children }: { readonly label: string; readonly hint?: string; readonly children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-muted-foreground text-xs uppercase" htmlFor={id}>
        {label}
        {hint ? <span className="ml-2 normal-case">{hint}</span> : null}
      </label>
      {children(id)}
    </div>
  );
}

function FormShell({
  onSubmit,
  pending,
  error,
  children,
}: {
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly pending: boolean;
  readonly error?: string;
  readonly children: ReactNode;
}) {
  return (
    <form className="flex flex-col gap-3 border-ink border-t-2 pt-4" onSubmit={onSubmit}>
      {children}
      {error ? (
        <p className="font-mono text-broken text-xs uppercase" role="alert">
          {error}
        </p>
      ) : null}
      <button className={cn(BUTTON, "self-start bg-safety text-ink")} disabled={pending} type="submit">
        {pending ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
        {pending ? "Checking…" : "Check & connect"}
      </button>
    </form>
  );
}

function SentryForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const { pending, error, submit } = useSubmit("sentry", onDone);
  return (
    <FormShell error={error} onSubmit={submit} pending={pending}>
      <Labeled hint="Settings → Developer settings → internal integration or org token" label="Auth token">
        {(id) => <input autoComplete="off" className={FIELD} id={id} name="token" required spellCheck={false} type="password" />}
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Org slug">
          {(id) => <input autoComplete="off" className={FIELD} id={id} name="org" placeholder="acme" required spellCheck={false} />}
        </Labeled>
        <Labeled label="Project slug">
          {(id) => <input autoComplete="off" className={FIELD} id={id} name="project" placeholder="web-app" required spellCheck={false} />}
        </Labeled>
      </div>
    </FormShell>
  );
}

function PosthogForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const { pending, error, submit } = useSubmit("posthog", onDone);
  return (
    <FormShell error={error} onSubmit={submit} pending={pending}>
      <Labeled hint="phx_… · scope preset “MCP Server”" label="Personal API key">
        {(id) => <input autoComplete="off" className={FIELD} id={id} name="apiKey" required spellCheck={false} type="password" />}
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Project id">
          {(id) => <input className={FIELD} id={id} inputMode="numeric" name="projectId" placeholder="12345" required />}
        </Labeled>
        <Labeled label="Cloud">
          {(id) => (
            <select className={FIELD} defaultValue="us" id={id} name="region">
              <option value="us">US · us.posthog.com</option>
              <option value="eu">EU · eu.posthog.com</option>
            </select>
          )}
        </Labeled>
      </div>
    </FormShell>
  );
}
