import { and, eq, sql } from "drizzle-orm";

// GitHub App lifecycle webhooks keep a workspace's `github` connection honest after the install
// round trip: uninstalling or suspending the App, and adding or removing repos on the install
// page, only reach Roary as webhooks. eve's githubChannel ignores these events, so
// agent/channels/github.ts peels them off before delegating everything else to it.
//
// Routed by payload.installation.id: the connection whose config.installationId matches (at most
// one, see connections_github_installation_unique). An installation nobody claimed (the demo
// shop's own install) is ignored. GitHub never reuses installation ids, so a deleted install keeps
// its id on the row: a reinstall arrives with a new id and is claimed through the callback again.

export const LIFECYCLE_EVENTS = ["installation", "installation_repositories"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

const INSTALLATION_ACTIONS = new Set(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]);

type Repo = { full_name?: unknown };
export type LifecyclePayload = {
  action?: unknown;
  installation?: { id?: unknown } | null;
  repository?: unknown;
  repositories_added?: Repo[] | null;
  repositories_removed?: Repo[] | null;
};

export type GithubRow = { workspaceId: number; status: string; repos: string[] };
export type RowPatch = { status?: string; repos?: string[] };

/** Storage seam: read-modify-write one installation's row atomically (Postgres: SELECT … FOR UPDATE). */
export type LifecycleStore = {
  mutate(installationId: string, change: (row: GithubRow) => RowPatch | null): Promise<GithubRow | null>;
};

export type LifecycleOutcome =
  | { handled: false; reason: "not_lifecycle" | "no_installation" | "unclaimed" | "ignored_action"; action?: string }
  | { handled: true; action: string; workspaceId: number; status: string; repos: string[] };

/**
 * Which lifecycle event this is, from the X-GitHub-Event header or, when a forwarder drops it,
 * the payload's shape (eve tolerates a missing header too). Anything else returns null.
 */
export function lifecycleEventOf(headerEvent: string | null, payload: LifecyclePayload): LifecycleEvent | null {
  if (headerEvent) return (LIFECYCLE_EVENTS as readonly string[]).includes(headerEvent) ? (headerEvent as LifecycleEvent) : null;
  if (!payload.installation || payload.repository !== undefined) return null;
  if (Array.isArray(payload.repositories_added) || Array.isArray(payload.repositories_removed)) return "installation_repositories";
  return typeof payload.action === "string" && INSTALLATION_ACTIONS.has(payload.action) ? "installation" : null;
}

function names(repos: Repo[] | null | undefined): string[] {
  return (repos ?? []).map((r) => r.full_name).filter((n): n is string => typeof n === "string" && n.includes("/"));
}

/** Set-based so a retried delivery is a no-op: drop the removed, append the added that are new. */
export function nextRepos(current: readonly string[], added: readonly string[], removed: readonly string[]): string[] {
  const gone = new Set(removed);
  const kept = current.filter((r) => !gone.has(r));
  for (const repo of added) if (!gone.has(repo) && !kept.includes(repo)) kept.push(repo);
  return kept;
}

/** Applies one verified lifecycle webhook to the connection that owns its installation. */
export async function applyGithubLifecycle(event: LifecycleEvent, payload: LifecyclePayload, store: LifecycleStore): Promise<LifecycleOutcome> {
  const rawId = payload.installation?.id;
  const installationId = typeof rawId === "number" || typeof rawId === "string" ? String(rawId) : "";
  if (!/^\d{1,20}$/.test(installationId)) return { handled: false, reason: "no_installation" };
  const action = typeof payload.action === "string" ? payload.action : "";

  let change: (row: GithubRow) => RowPatch | null;
  if (event === "installation_repositories") {
    const added = names(payload.repositories_added);
    const removed = names(payload.repositories_removed);
    change = (row) => ({ repos: nextRepos(row.repos, added, removed) });
  } else if (action === "deleted") {
    change = () => ({ status: "disconnected" });
  } else if (action === "suspend") {
    change = (row) => (row.status === "disconnected" ? null : { status: "error" });
  } else if (action === "unsuspend") {
    // Only undo a suspension; an uninstalled or never-verified row stays as it is.
    change = (row) => (row.status === "error" ? { status: "connected" } : null);
  } else {
    return { handled: false, reason: "ignored_action", action };
  }

  const row = await store.mutate(installationId, change);
  if (!row) return { handled: false, reason: "unclaimed", action };
  return { handled: true, action: `${event}.${action}`, workspaceId: row.workspaceId, status: row.status, repos: row.repos };
}

/** The real store over `connections` (lazy import: tests can run the pure parts without a DB). */
export async function postgresLifecycleStore(): Promise<LifecycleStore> {
  const { db, schema } = await import("./db");
  const { connections } = schema;
  return {
    async mutate(installationId, change) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(connections)
          .where(and(eq(connections.provider, "github"), sql`${connections.config}->>'installationId' = ${installationId}`))
          .limit(1)
          .for("update");
        if (!row) return null;
        const config = row.config as { repos?: unknown };
        const current: GithubRow = {
          workspaceId: row.workspaceId,
          status: row.status,
          repos: Array.isArray(config.repos) ? config.repos.filter((r): r is string => typeof r === "string") : [],
        };
        const patch = change(current);
        if (!patch) return current;
        const next = { ...current, ...patch };
        await tx
          .update(connections)
          .set({
            status: next.status,
            config: { ...row.config, repos: next.repos },
            updatedAt: sql`now()`,
          })
          .where(eq(connections.id, row.id));
        return next;
      });
    },
  };
}

export type LifecycleDeps = {
  /** Connect's webhook verifier (Vercel OIDC): falsy or throwing means reject; a string replaces the body. */
  verify: ((request: Request, body: string) => unknown) | undefined;
  store: () => Promise<LifecycleStore>;
  log?: (message: string, detail: Record<string, unknown>) => void;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * The lifecycle half of POST /eve/v1/github. Returns null for every event that isn't a lifecycle
 * event, without consuming the request body, so eve's own handler still reads and verifies it.
 */
export async function handleLifecycleRequest(request: Request, deps: LifecycleDeps): Promise<Response | null> {
  const header = request.headers.get("x-github-event");
  if (header && !(LIFECYCLE_EVENTS as readonly string[]).includes(header)) return null;
  const body = await request.clone().text();
  let payload: LifecyclePayload;
  try {
    payload = JSON.parse(body) as LifecyclePayload;
  } catch {
    return null; // Not JSON: let eve answer as it always has.
  }
  const event = lifecycleEventOf(header, payload);
  if (!event) return null;

  let verified: unknown = null;
  try {
    verified = deps.verify ? await deps.verify(request.clone(), body) : null;
  } catch {
    verified = null;
  }
  if (!verified) return new Response("unauthorized", { status: 401 });
  let trusted = payload;
  if (typeof verified === "string") {
    try {
      trusted = JSON.parse(verified) as LifecyclePayload;
    } catch {
      return json({ ok: true, ignored: true });
    }
  }

  const log = deps.log ?? ((message, detail) => console.info(message, detail));
  try {
    const outcome = await applyGithubLifecycle(event, trusted, await deps.store());
    log("github lifecycle", { event, installationId: trusted.installation?.id ?? null, ...outcome });
    return json({ ok: true, ...outcome });
  } catch (error) {
    log("github lifecycle failed", { event, error: error instanceof Error ? error.name : "unknown" });
    return json({ ok: false }, 500); // GitHub records the failed delivery; it can be redelivered.
  }
}
