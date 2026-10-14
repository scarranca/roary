import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { ConnectionProvider } from "./schema";

export type Workspace = typeof schema.workspaces.$inferSelect;
export type Connection = typeof schema.connections.$inferSelect;
export type ResolvedWorkspace = { workspace: Workspace; connections: Connection[] };

/** The authenticator name agent/channels/eve.ts stamps on a verified Neon Auth user. */
export const NEON_AUTH_AUTHENTICATOR = "neon-auth";

/** The subset of eve's SessionAuthContext this module reads. */
export type Principal = {
  readonly authenticator: string;
  readonly principalType: string;
  readonly principalId: string;
} | null | undefined;

/**
 * Only a verified Neon Auth user gets a workspace of their own. Everyone else (anonymous
 * browsers, `localDev()`, Vercel OIDC callers, Sentry webhooks, GitHub events) is a guest.
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

/** The caller's workspace and its connections. Guests resolve to the demo workspace. */
export async function resolveWorkspace(principal: Principal): Promise<ResolvedWorkspace> {
  const userId = workspaceUserId(principal);
  const workspace = userId
    ? ((await findUserWorkspace(userId)) ?? (await createUserWorkspace(userId)))
    : await getDemoWorkspace();
  return { workspace, connections: await loadConnections(workspace.id) };
}

export function findConnection(resolved: ResolvedWorkspace, provider: ConnectionProvider): Connection | undefined {
  return resolved.connections.find((c) => c.provider === provider && c.status !== "disabled");
}

/**
 * The single place a provider token is chosen: the connection's own encrypted secret, or the
 * app-level env token, but the env token only for the demo workspace. A signed-in workspace
 * never falls back to Roary's demo credentials.
 */
export function tokenFor(resolved: ResolvedWorkspace, connection: Connection | undefined, envToken: string | undefined): string | null {
  if (!connection) return null;
  if (connection.secretCiphertext) return decryptSecret(connection.secretCiphertext);
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

// --- secrets: AES-256-GCM, key = CONNECTIONS_ENCRYPTION_KEY (32 bytes, base64) ---------------

const CIPHER_VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CONNECTIONS_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTIONS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return key;
}

/** Encrypts a provider token as `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [CIPHER_VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== CIPHER_VERSION || !iv || !tag || !ciphertext) throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
