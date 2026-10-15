import { and, eq, sql } from "drizzle-orm";
import { openConnectionSecret, sealConnectionSecret } from "./crypto";
import { db, schema } from "./db";
import {
  exchangeGrantCode,
  refreshInstallationToken,
  SENTRY_API,
  SentryAppError,
  type SentryAppConfig,
  sentryAppConfig,
  sentryAppCredentials,
  UUID,
} from "./sentry-app";

// The database side of the public Sentry App (agent/lib/sentry-app.ts has the HTTP side):
// storing an install in `connections`, refreshing its token, routing webhooks, claiming incidents.

type ConnectionRow = typeof schema.connections.$inferSelect;

/** Refresh this long before Sentry's expiry (tokens live 8h), so a token never dies mid-turn. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function needsRefresh(config: SentryAppConfig): boolean {
  return Date.parse(config.expiresAt) - Date.now() < REFRESH_MARGIN_MS;
}

/**
 * The installation token for a Sentry App connection, refreshed when it is within five minutes
 * of expiry. The refresh runs under a per-connection advisory lock and re-reads the row inside
 * it, so concurrent tool calls refresh once and the rest reuse the new token.
 */
export async function sentryAppToken(connection: ConnectionRow): Promise<string | null> {
  const config = sentryAppConfig(connection);
  if (!config || !connection.secretCiphertext || connection.status !== "connected") return null;
  if (!needsRefresh(config)) return openConnectionSecret({ ...connection, secretCiphertext: connection.secretCiphertext });

  const app = sentryAppCredentials();
  if (!app) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`roary-sentry-refresh:${connection.id}`}))`);
    const [row] = await tx.select().from(schema.connections).where(eq(schema.connections.id, connection.id)).limit(1);
    const current = row ? sentryAppConfig(row) : null;
    if (!row || !current || !row.secretCiphertext || row.status !== "connected") return null;
    if (!needsRefresh(current)) return openConnectionSecret({ ...row, secretCiphertext: row.secretCiphertext });

    const fresh = await refreshInstallationToken(app, current.installationUuid);
    await tx
      .update(schema.connections)
      .set({
        secretCiphertext: sealConnectionSecret(row.workspaceId, "sentry", fresh.token),
        config: { ...current, expiresAt: fresh.expiresAt },
        updatedAt: sql`now()`,
      })
      .where(eq(schema.connections.id, row.id));
    return fresh.token;
  });
}

/** The `connections` row holding this Sentry App installation, whatever its status. */
export async function findSentryInstallation(installationUuid: string): Promise<ConnectionRow | undefined> {
  if (!UUID.test(installationUuid)) return undefined;
  const [row] = await db
    .select()
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.provider, "sentry"),
        sql`${schema.connections.config}->>'source' = 'sentry-app'`,
        sql`${schema.connections.config}->>'installationUuid' = ${installationUuid}`,
      ),
    )
    .limit(1);
  return row;
}

async function sentryRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SENTRY_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
}

async function getJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const response = await sentryRequest(path, token);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export type ClaimResult = { ok: true; org: string; project?: string } | { ok: false; code: string };

/**
 * Finish an install for `workspaceId`: exchange the grant code (single use, so a successful
 * exchange proves this redirect came from the real install), confirm the install with Sentry
 * ("Verify Install"), and store the token encrypted. One installation belongs to one workspace.
 */
export async function claimSentryInstallation(
  workspaceId: number,
  input: { installationUuid: string; code: string; orgSlug?: string },
): Promise<ClaimResult> {
  const app = sentryAppCredentials();
  if (!app) return { ok: false, code: "unavailable" };
  if (!UUID.test(input.installationUuid) || !/^[0-9a-z]{16,128}$/i.test(input.code)) return { ok: false, code: "bad_input" };

  const owner = await findSentryInstallation(input.installationUuid);
  if (owner && owner.workspaceId !== workspaceId && owner.status === "connected") return { ok: false, code: "claimed" };

  let token: Awaited<ReturnType<typeof exchangeGrantCode>>;
  try {
    token = await exchangeGrantCode(app, input.installationUuid, input.code);
  } catch (error) {
    return { ok: false, code: error instanceof SentryAppError ? error.code : "unreachable" };
  }

  // The installation's own record names its org; the query string's orgSlug is only a fallback.
  const details = await getJson<{ organization?: { slug?: string } }>(`/sentry-app-installations/${input.installationUuid}/`, token.token);
  const org = details?.organization?.slug ?? input.orgSlug;
  if (!org || !SLUG.test(org)) return { ok: false, code: "no_org" };

  // Required for the install to leave "pending" when the app has "Verify Install" on; harmless otherwise.
  await sentryRequest(`/sentry-app-installations/${input.installationUuid}/`, token.token, {
    method: "PUT",
    body: JSON.stringify({ status: "installed" }),
  }).catch(() => undefined);

  // An install is org-wide; pre-select the project when the org has exactly one.
  const projects = await getJson<{ slug?: string }[]>(`/organizations/${org}/projects/`, token.token);
  const only = projects?.length === 1 ? projects[0]?.slug : undefined;
  const project = only && SLUG.test(only) ? only : undefined;

  const config: SentryAppConfig = {
    org,
    ...(project ? { project } : {}),
    installationUuid: input.installationUuid,
    expiresAt: token.expiresAt,
    source: "sentry-app",
  };
  const values = {
    status: "connected",
    config: config as unknown as Record<string, unknown>,
    secretCiphertext: sealConnectionSecret(workspaceId, "sentry", token.token),
    connectorRef: null,
  };
  await db
    .insert(schema.connections)
    .values({ workspaceId, provider: "sentry", ...values })
    .onConflictDoUpdate({
      target: [schema.connections.workspaceId, schema.connections.provider],
      set: { ...values, updatedAt: sql`now()` },
    });
  return { ok: true, org, ...(project ? { project } : {}) };
}

/** `installation.deleted`: the org uninstalled Roary. Drop the token and stop routing to it. */
export async function markSentryInstallationDisconnected(installationUuid: string): Promise<number | null> {
  const row = await findSentryInstallation(installationUuid);
  if (!row) return null;
  await db
    .update(schema.connections)
    .set({ status: "disconnected", secretCiphertext: null, updatedAt: sql`now()` })
    .where(eq(schema.connections.id, row.id));
  return row.workspaceId;
}

/**
 * Atomic per-workspace claim of an incident for a webhook-started triage. `sentry_issue_id` is
 * globally unique but short ids aren't unique across Sentry orgs, so when another workspace already
 * holds this key the claim falls back to a workspace-scoped key `<key>@ws<id>`.
 * Returns null when this workspace already claimed the issue (Sentry retries, duplicate alerts).
 */
export async function claimIncident(workspaceId: number, key: string, title: string): Promise<{ id: number; key: string } | null> {
  const insert = (sentryIssueId: string) =>
    db
      .insert(schema.incidents)
      .values({ sentryIssueId, title, status: "investigating", workspaceId })
      .onConflictDoNothing({ target: schema.incidents.sentryIssueId })
      .returning({ id: schema.incidents.id });

  const [claimed] = await insert(key);
  if (claimed) return { id: claimed.id, key };
  const [existing] = await db
    .select({ workspaceId: schema.incidents.workspaceId })
    .from(schema.incidents)
    .where(eq(schema.incidents.sentryIssueId, key))
    .limit(1);
  if (!existing || existing.workspaceId === workspaceId) return null;
  const scoped = `${key}@ws${workspaceId}`;
  const [fallback] = await insert(scoped);
  return fallback ? { id: fallback.id, key: scoped } : null;
}
