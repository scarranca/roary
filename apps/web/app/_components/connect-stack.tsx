"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, LoaderIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { authClient } from "@/lib/auth/client";
import type { Provider, PublicConnection } from "@/lib/connections/types";
import { cn } from "@/lib/utils";
import { AuthDialog } from "./auth-dialog";

type Stack = {
  signedIn: boolean;
  githubEnabled?: boolean;
  /** SENTRY_PUBLIC_INTEGRATION_ENABLED: shows "Install Roary in Sentry". */
  sentryAppEnabled?: boolean;
  connections: Record<Provider, PublicConnection | null>;
  /** Quick connect: this workspace's own webhook URLs (signed in only). */
  webhooks?: { github: string; sentry: string };
};

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
              githubAppEnabled={provider.id === "github" && stack?.signedIn === true && stack.githubEnabled === true}
              sentryAppEnabled={provider.id === "sentry" && stack?.signedIn === true && stack.sentryAppEnabled === true}
              signedIn={stack?.signedIn ?? false}
              webhookUrl={provider.id === "posthog" ? undefined : stack?.webhooks?.[provider.id]}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

type CardStatus = "demo" | "connected" | "pending" | "error" | "disconnected" | "none";

function StatusTag({ status }: { readonly status: CardStatus }) {
  const look = {
    demo: ["bg-ok-soft text-ok", "✅ Demo shop"],
    connected: ["bg-ok-soft text-ok", "✅ Connected"],
    pending: ["bg-wait-soft text-wait", "⏳ Waiting on approval"],
    error: ["bg-broken-soft text-broken", "❌ Needs attention"],
    disconnected: ["bg-broken-soft text-broken", "❌ Uninstalled"],
    none: ["bg-label text-ink", "❌ Not connected"],
  } as const;
  // A status this build doesn't know yet (a newer server) must not take the page down.
  const [color, label] = look[status] ?? look.error;
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

const DAY_MS = 86_400_000;

/** Days until a GitHub token expires (null: no expiry). */
function daysLeft(expiresAt: unknown): number | null {
  if (typeof expiresAt !== "string") return null;
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) ? null : Math.floor((ms - Date.now()) / DAY_MS);
}

function isGithubPat(connection: PublicConnection | null): boolean {
  return connection?.provider === "github" && (connection.config as { mode?: string }).mode === "pat";
}

function describe(connection: PublicConnection): string {
  const config = connection.config as Record<string, unknown>;
  if (isGithubPat(connection)) {
    const repos = (config.repos as string[] | undefined) ?? [];
    const days = daysLeft(config.expiresAt);
    const expiry = days === null ? "no expiry" : days < 0 ? "expired" : `expires in ${days} day${days === 1 ? "" : "s"}`;
    if (connection.status === "error") return `@${config.login} · GitHub refused the token or a repo. Run Test, or replace the token.`;
    return `Connected as @${config.login} · ${repos.length} repo${repos.length === 1 ? "" : "s"} · ${expiry}`;
  }
  if (connection.provider === "github") {
    const repos = (config.repos as string[] | undefined) ?? [];
    if (!config.installationId) return "An org owner has to approve the install on GitHub.";
    if (connection.status === "disconnected") return "Roary was uninstalled on GitHub. Install it again to reconnect.";
    if (connection.status === "error") return "GitHub suspended Roary's installation or it lost access. Run Test, or install again.";
    return `${repos.length} repo${repos.length === 1 ? "" : "s"}${repos.length ? ` · ${repos.slice(0, 3).join(", ")}${repos.length > 3 ? "…" : ""}` : ""}`;
  }
  if (connection.provider === "sentry") {
    if (config.source === "internal") return `${config.org} / ${config.project} · your integration's alerts start triage`;
    if (config.source !== "sentry-app") return `${config.org} / ${config.project}`;
    if (connection.status === "disconnected") return `${config.org} · Roary was uninstalled in Sentry`;
    return `${config.org} / ${config.project ?? "all projects"} · Sentry app, alerts start triage`;
  }
  return `Project ${config.projectId} · ${String(config.host).includes("eu.") ? "EU" : "US"} cloud`;
}

function ProviderCard({
  provider,
  connection,
  signedIn,
  loading,
  onChange,
  githubAppEnabled = false,
  sentryAppEnabled = false,
  webhookUrl,
}: {
  readonly provider: (typeof PROVIDERS)[number];
  readonly connection: PublicConnection | null;
  readonly signedIn: boolean;
  readonly loading: boolean;
  /** The GitHub App install, second to quick connect, behind GITHUB_CONNECT_ENABLED. */
  readonly githubAppEnabled?: boolean;
  /** Public Sentry App install (SENTRY_PUBLIC_INTEGRATION_ENABLED), next to pasting a token. */
  readonly sentryAppEnabled?: boolean;
  /** This workspace's quick-connect webhook URL for the provider. */
  readonly webhookUrl?: string;
  readonly onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  // A just-created GitHub webhook secret: shown once, gone on reload.
  const [webhookSecret, setWebhookSecret] = useState<string>();
  const days = isGithubPat(connection) ? daysLeft((connection?.config as { expiresAt?: unknown }).expiresAt) : null;
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
        {!signedIn ? provider.demo : connection ? describe(connection) : "Not connected yet."}
      </p>
      {days !== null && days < 14 ? (
        <p className="font-mono text-broken text-xs uppercase" role="status">
          {days < 0 ? "This token has expired. Paste a new one." : "This token expires soon. Make a new one on GitHub and paste it with Replace token."}
        </p>
      ) : null}

      {signedIn ? (
        <div className="flex flex-wrap gap-2">
          {provider.id === "github" ? (
            <button
              aria-expanded={open}
              className={cn(BUTTON, open ? "bg-label" : "bg-safety text-ink")}
              onClick={() => setOpen((o) => !o)}
              type="button"
            >
              {open ? "Cancel" : isGithubPat(connection) ? "Replace token" : "Quick connect"}
            </button>
          ) : null}
          {provider.id === "github" && githubAppEnabled ? (
            <a className={cn(BUTTON, "bg-card")} href="/api/connect/github/install" rel="noopener" target="_blank">
              {connection?.status === "connected" && !isGithubPat(connection) ? "Change repos" : "Install the GitHub App"}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
          {/* Hidden while the app is installed: Sentry's install page refuses a second install per org. */}
          {provider.id === "sentry" &&
          sentryAppEnabled &&
          !(connection?.status !== "disconnected" && (connection?.config as { source?: string } | undefined)?.source === "sentry-app") ? (
            <a className={cn(BUTTON, "bg-safety text-ink")} href="/api/connect/sentry/install" rel="noopener" target="_blank">
              {connection?.status === "disconnected" ? "Install again in Sentry" : "Install Roary in Sentry"}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
          {provider.id !== "github" ? (
            <button
              aria-expanded={open}
              className={cn(BUTTON, open ? "bg-label" : "bg-safety text-ink")}
              onClick={() => setOpen((o) => !o)}
              type="button"
            >
              {open ? "Cancel" : connection ? "Replace key" : provider.id === "sentry" ? "Quick connect" : "Connect"}
            </button>
          ) : null}
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

      {open && provider.id === "github" ? (
        <GithubPatForm
          onDone={async (secret) => {
            setOpen(false);
            if (secret) setWebhookSecret(secret);
            setResult({ ok: true, text: "Connected. The token is stored encrypted." });
            await onChange();
          }}
        />
      ) : null}
      {signedIn && provider.id === "github" && isGithubPat(connection) && webhookUrl ? (
        <GithubWebhookSetup onSecret={setWebhookSecret} secret={webhookSecret} url={webhookUrl} />
      ) : null}
      {open && provider.id === "sentry" ? (
        <SentryForm
          webhookUrl={webhookUrl}
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

function useSubmit(provider: Provider, onDone: (reply: { webhookSecret?: string | null }) => Promise<void>) {
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
      const reply = (await response.json()) as { error?: string; webhookSecret?: string | null };
      if (!response.ok) {
        setError(reply.error ?? "That didn't work.");
        return;
      }
      form.reset();
      await onDone(reply);
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

function SentryForm({ onDone, webhookUrl }: { readonly onDone: () => Promise<void>; readonly webhookUrl?: string }) {
  const { pending, error, submit } = useSubmit("sentry", onDone);
  return (
    <FormShell error={error} onSubmit={submit} pending={pending}>
      {webhookUrl ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5 font-mono text-xs leading-relaxed">
          <li>
            Quick connect, for automatic triage: in Sentry, Settings → Developer Settings → Create New Integration →{" "}
            <b>Internal Integration</b>.
          </li>
          <li>
            Permissions: Project <b>Read</b>, Issue &amp; Event <b>Read</b>, Organization <b>Read</b>. Webhooks: tick <b>issue</b>.
          </li>
          <li className="flex flex-col gap-1.5">
            Webhook URL:
            <CopyField label="Sentry webhook URL" value={webhookUrl} />
          </li>
          <li>Save it, then paste its Token and Client Secret below with your org and project slugs.</li>
        </ol>
      ) : null}
      <Labeled hint="the integration's token (or an org token)" label="Auth token">
        {(id) => <input autoComplete="off" className={FIELD} id={id} name="token" required spellCheck={false} type="password" />}
      </Labeled>
      <Labeled hint="optional · turns on automatic triage (empty keeps the current one)" label="Client secret">
        {(id) => <input autoComplete="off" className={FIELD} id={id} name="clientSecret" spellCheck={false} type="password" />}
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

/** A read-only value with a Copy button (webhook URL, secret). */
function CopyField({ label, value, secret = false }: { readonly label: string; readonly value: string; readonly secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <input
        aria-label={label}
        className={cn(FIELD, "min-w-0 flex-1 py-1.5 text-xs", secret && "tracking-tight")}
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        spellCheck={false}
        value={value}
      />
      <button aria-label={`Copy ${label}`} className={cn(BUTTON, "bg-card px-3 py-1.5")} onClick={() => void copy()} type="button">
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Quick connect for GitHub: a fine-grained personal access token and the repos it covers. */
function GithubPatForm({ onDone }: { readonly onDone: (webhookSecret: string | undefined) => Promise<void> }) {
  const { pending, error, submit } = useSubmit("github", (reply) => onDone(reply.webhookSecret ?? undefined));
  return (
    <FormShell error={error} onSubmit={submit} pending={pending}>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 font-mono text-xs leading-relaxed">
        <li>
          On GitHub: Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.
          Tip: use a bot or shared account, since Roary's comments and PRs appear as the token's user.
        </li>
        <li>
          Repository access: <b>Only select repositories</b>. Permissions: <b>Contents</b>, <b>Issues</b>, <b>Pull requests</b>:
          Read and write (Metadata: Read is added for you).
        </li>
        <li>Paste the token and the same repos here.</li>
      </ol>
      <Labeled hint="github_pat_…" label="Personal access token">
        {(id) => <input autoComplete="off" className={FIELD} id={id} name="token" required spellCheck={false} type="password" />}
      </Labeled>
      <Labeled hint="owner/name, one per line or comma separated" label="Repos">
        {(id) => (
          <textarea
            autoComplete="off"
            className={cn(FIELD, "min-h-20")}
            id={id}
            name="repos"
            placeholder={"acme/web\nacme/api"}
            required
            spellCheck={false}
          />
        )}
      </Labeled>
    </FormShell>
  );
}

/** What to paste into each repo's Settings → Webhooks → Add webhook, so @roary and launch videos work. */
function GithubWebhookSetup({
  url,
  secret,
  onSecret,
}: {
  readonly url: string;
  readonly secret?: string;
  readonly onSecret: (secret: string) => void;
}) {
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string>();
  const rotate = async () => {
    if (!window.confirm("Make a new webhook secret? The current one stops working until you paste the new one into GitHub.")) return;
    setRotating(true);
    setError(undefined);
    try {
      const response = await fetch("/api/connections/github/webhook-secret", { method: "POST" });
      const body = (await response.json()) as { webhookSecret?: string; error?: string };
      if (!response.ok || !body.webhookSecret) setError(body.error ?? "Couldn't make a new secret.");
      else onSecret(body.webhookSecret);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setRotating(false);
    }
  };
  return (
    <section aria-label="GitHub webhook" className="flex flex-col gap-2 border-ink border-t-2 pt-4 font-mono text-xs">
      <p className="uppercase">
        For @roary mentions and launch videos: in each repo, Settings → Webhooks → <b>Add webhook</b>.
      </p>
      <span className="text-muted-foreground uppercase">Payload URL</span>
      <CopyField label="GitHub payload URL" value={url} />
      <span className="text-muted-foreground uppercase">
        Content type: <b className="text-ink">application/json</b>
      </span>
      <span className="text-muted-foreground uppercase">Secret</span>
      {secret ? (
        <>
          <CopyField label="GitHub webhook secret" secret value={secret} />
          <span className="text-broken uppercase">Copy it now: it won't be shown again.</span>
        </>
      ) : (
        <span>
          Shown once when you connected.{" "}
          <button className="underline" disabled={rotating} onClick={() => void rotate()} type="button">
            {rotating ? "Making one…" : "Make a new secret"}
          </button>
        </span>
      )}
      <span className="text-muted-foreground uppercase">
        Events: Let me select → <b className="text-ink">Issue comments</b>, <b className="text-ink">Issues</b>,{" "}
        <b className="text-ink">Pull requests</b>
      </span>
      {error ? (
        <span className="text-broken uppercase" role="alert">
          {error}
        </span>
      ) : null}
    </section>
  );
}
