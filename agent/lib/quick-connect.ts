import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { openWebhookSecret } from "./crypto";
import { db, schema } from "./db";
import { githubPatConfig, PUBLIC_ID, sentryInternalConfig } from "./quick-connect-config";

// "Quick connect: paste your keys". A team connects GitHub with a fine-grained personal access
// token and points its own repo webhook and Sentry internal integration at per-workspace URLs:
//   /github/webhook/<workspace public id>   (agent/channels/github-webhook.ts)
//   /sentry/webhook/<workspace public id>   (agent/channels/sentry-workspace-webhook.ts)
// Each is verified with THAT workspace's own secret (connections.webhook_secret_ciphertext).
// This is the database side; the pure config helpers are in agent/lib/quick-connect-config.ts.

type ConnectionRow = typeof schema.connections.$inferSelect;
type WorkspaceRow = typeof schema.workspaces.$inferSelect;

export async function findWorkspaceByPublicId(publicId: string): Promise<WorkspaceRow | undefined> {
  if (!PUBLIC_ID.test(publicId)) return undefined;
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.publicId, publicId)).limit(1);
  return workspace;
}

export type WebhookTarget = { workspace: WorkspaceRow; connection: ConnectionRow; secret: string };

/**
 * The workspace behind a per-workspace webhook URL, its connection for `provider`, and the
 * decrypted signing secret. Null when the id is unknown, the workspace is the demo, the
 * connection is missing/uninstalled/not a quick connect, or it has no webhook secret (404).
 */
export async function loadWebhookTarget(publicId: string, provider: "github" | "sentry"): Promise<WebhookTarget | null> {
  const workspace = await findWorkspaceByPublicId(publicId);
  if (!workspace || workspace.isDemo) return null;
  const [connection] = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.workspaceId, workspace.id), eq(schema.connections.provider, provider)))
    .limit(1);
  if (!connection?.webhookSecretCiphertext || connection.status === "disabled" || connection.status === "disconnected") return null;
  const isQuickConnect = provider === "github" ? githubPatConfig(connection) : sentryInternalConfig(connection);
  if (!isQuickConnect) return null;
  try {
    return { workspace, connection, secret: openWebhookSecret({ ...connection, webhookSecretCiphertext: connection.webhookSecretCiphertext }) };
  } catch {
    return null; // key rotated: the card's Test says "connect again"
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** GitHub's `X-Hub-Signature-256`: `sha256=` + HMAC-SHA256(secret, raw body) in hex. */
export function verifyGithubSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`);
}

/** First time this delivery id is seen for the workspace? Replays and retries get false. */
export async function claimDelivery(workspaceId: number, provider: string, deliveryId: string): Promise<boolean> {
  const rows = await db
    .insert(schema.webhookDeliveries)
    .values({ workspaceId, provider, deliveryId: deliveryId.slice(0, 200) })
    .onConflictDoNothing()
    .returning({ deliveryId: schema.webhookDeliveries.deliveryId });
  return rows.length > 0;
}

/** Forget a claimed delivery (it was refused, e.g. rate limited), so a manual redeliver runs. */
export async function releaseDelivery(workspaceId: number, provider: string, deliveryId: string): Promise<void> {
  await db
    .delete(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.workspaceId, workspaceId),
        eq(schema.webhookDeliveries.provider, provider),
        eq(schema.webhookDeliveries.deliveryId, deliveryId.slice(0, 200)),
      ),
    );
}
