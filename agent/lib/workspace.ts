import { and, eq, isNull, sql } from "drizzle-orm";
import { openConnectionSecret } from "./crypto";
import { db, schema } from "./db";
import type { ConnectionProvider } from "./schema";
import { sentryAppConfig } from "./sentry-app";
import { findSentryInstallation, sentryAppToken, sentryConnectionUsable } from "./sentry-app-store";

export type Workspace = typeof schema.workspaces.$inferSelect;
export type Connection = typeof schema.connections.$inferSelect;
export type ResolvedWorkspace = { workspace: Workspace; connections: Connection[] };

/** The authenticator name agent/channels/eve.ts stamps on a verified Neon Auth user. */
export const NEON_AUTH_AUTHENTICATOR = "neon-auth";

/** The authenticator eve's GitHub channel stamps on webhook-started turns (defaultGitHubAuth). */
export const GITHUB_WEBHOOK_AUTHENTICATOR = "github-webhook";

/**
 * The authenticator agent/channels/sentry-webhook.ts stamps on alert-started turns. Only turns
 * started by the PUBLIC Sentry App (signature checked with SENTRY_CLIENT_SECRET) carry
 * attributes {sentry_app: "public", installation_uuid}, which route to a workspace.
 */
export const SENTRY_WEBHOOK_AUTHENTICATOR = "sentry-webhook";

/** The subset of eve's SessionAuthContext this module reads. */
export type Principal = {
  readonly authenticator: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly attributes?: Readonly<Record<string, string | readonly string[] | undefined>>;
} | null | undefined;

/**
 * Only a verified Neon Auth user gets a workspace of their own. Everyone else (anonymous
 * browsers, `localDev()`, Vercel OIDC callers, Sentry webhooks) is a guest. GitHub webhook
 * turns are routed by installation in resolveWorkspace.
 */
export function workspaceUserId(principal: Principal): string | null {
  return principal?.authenticator === NEON_AUTH_AUTHENTICATOR && principal.principalType === "user"
    ? principal.principalId
    : null;
}

async function loadConnections(workspaceId: number): Promise<Connection[]> {
  return db.select().from(schema.connections).where(eq(schema.connections.workspaceId, workspaceId));
}

export async function getDemoWorkspace(): Promise<Workspace> {
  const [demo] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.isDemo, true)).limit(1);
  if (!demo) throw new Error("The demo workspace is missing; run the 0003_workspaces migration.");
  return demo;
}

async function findUserWorkspace(userId: string): Promise<Workspace | undefined> {
  const [row] = await db
    .select({ workspace: schema.workspaces })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaces.id)
    .limit(1);
  return row?.workspace;
}

// First touch for a signed-in user: create their (empty) workspace. The advisory lock keeps two
// concurrent first messages from creating two workspaces.
async function createUserWorkspace(userId: string): Promise<Workspace> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`roary-workspace:${userId}`}))`);
    const [existing] = await tx
      .select({ workspace: schema.workspaces })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
      .where(eq(schema.workspaceMembers.userId, userId))
      .limit(1);
    if (existing) return existing.workspace;

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({ name: "My workspace", ownerUserId: userId })
      .returning();
    await tx.insert(schema.workspaceMembers).values({ workspaceId: workspace!.id, userId, role: "owner" });
    // Hires this person signed before workspaces existed move in with them.
    await tx
      .update(schema.roaryProfiles)
      .set({ workspaceId: workspace!.id })
      .where(and(eq(schema.roaryProfiles.userId, userId), isNull(schema.roaryProfiles.workspaceId)));
    return workspace!;
  });
}

/**
 * The workspace that connected this GitHub App installation, if any. GitHub webhook turns carry
 * the installation id (defaultGitHubAuth → attributes.installation_id). An installation nobody
 * claimed (the demo shop's own install) stays in the demo workspace.
 */
export async function findWorkspaceByGithubInstallation(installationId: string): Promise<Workspace | undefined> {
  if (!/^\d{1,20}$/.test(installationId)) return undefined;
  const [row] = await db
    .select({ workspace: schema.workspaces })
    .from(schema.connections)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.connections.workspaceId))
    .where(
      and(
        eq(schema.connections.provider, "github"),
        sql`${schema.connections.config}->>'installationId' = ${installationId}`,
      ),
    )
    .limit(1);
  return row?.workspace;
}

/** The workspace whose connected Sentry App installation this is (public integration). */
export async function findWorkspaceBySentryInstallation(installationUuid: string): Promise<Workspace | undefined> {
  const row = await findSentryInstallation(installationUuid);
  if (!row || !sentryConnectionUsable(row.status)) return undefined;
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, row.workspaceId)).limit(1);
  return workspace;
}

/**
 * The caller's workspace and its connections:
 * - a verified Neon Auth user → their own workspace (created on first touch);
 * - a GitHub webhook turn → the workspace that connected that installation, else the demo;
 * - a public Sentry App webhook turn → the workspace that installed it, else the demo;
 * - everyone else (guests, localDev, Vercel OIDC, the Sentry webhook) → the demo workspace.
 */
export async function resolveWorkspace(principal: Principal): Promise<ResolvedWorkspace> {
  const userId = workspaceUserId(principal);
  let workspace: Workspace | undefined;
  if (userId) {
    workspace = (await findUserWorkspace(userId)) ?? (await createUserWorkspace(userId));
  } else if (principal?.authenticator === GITHUB_WEBHOOK_AUTHENTICATOR) {
    const installationId = principal.attributes?.installation_id;
    if (typeof installationId === "string" && installationId) {
      workspace = await findWorkspaceByGithubInstallation(installationId);
    }
  } else if (principal?.authenticator === SENTRY_WEBHOOK_AUTHENTICATOR && principal.attributes?.sentry_app === "public") {
    const installationUuid = principal.attributes.installation_uuid;
    if (typeof installationUuid === "string" && installationUuid) {
      workspace = await findWorkspaceBySentryInstallation(installationUuid);
    }
  }
  workspace ??= await getDemoWorkspace();
  return { workspace, connections: await loadConnections(workspace.id) };
}

export function findConnection(resolved: ResolvedWorkspace, provider: ConnectionProvider): Connection | undefined {
  // "disconnected": the provider side uninstalled Roary (GitHub or Sentry `installation.deleted`).
  return resolved.connections.find((c) => c.provider === provider && c.status !== "disabled" && c.status !== "disconnected");
}

/**
 * The single place a provider credential is chosen, in this order:
 * 1. the connection's own secret (AES-GCM, agent/lib/crypto.ts, AAD = its workspace + provider),
 *    as saved by the web app's /api/connections routes. A Sentry App install's token (8h) is
 *    refreshed here when it is about to expire (agent/lib/sentry-app.ts);
 * 2. its Vercel Connect connector (`connector_ref`): an app token from that connector, pinned to
 *    the workspace's installation for `github`;
 * 3. the app-level env token, but only for the demo workspace.
 * A signed-in workspace never falls back to Roary's demo credentials.
 */
export async function credentialFor(
  resolved: ResolvedWorkspace,
  connection: Connection | undefined,
  envToken: string | undefined,
): Promise<string | null> {
  if (!connection) return null;
  if (sentryAppConfig(connection)) return sentryAppToken(connection);
  if (connection.secretCiphertext) {
    return openConnectionSecret({ ...connection, secretCiphertext: connection.secretCiphertext });
  }
  if (connection.connectorRef && !resolved.workspace.isDemo) {
    const installationId = (connection.config as { installationId?: unknown }).installationId;
    if (connection.provider === "github" && !installationId) return null;
    const { getToken } = await import("@vercel/connect");
    return getToken(connection.connectorRef, {
      subject: { type: "app" },
      ...(installationId ? { installationId: String(installationId) } : {}),
    });
  }
  return resolved.workspace.isDemo ? (envToken ?? null) : null;
}

/** Non-secret view of a workspace for the model or the UI: never includes ciphertext. */
export function describeWorkspace({ workspace, connections }: ResolvedWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    isDemo: workspace.isDemo,
    connections: connections.map((c) => ({ provider: c.provider, status: c.status, config: c.config })),
  };
}
