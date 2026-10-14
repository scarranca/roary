import { workspaceForTurn } from "./workspace-context";
import { findConnection, tokenFor } from "./workspace";

export type SentryAccess =
  | { ok: true; org: string; project: string | undefined; token: string; workspaceId: number }
  | { ok: false; error: string; message: string };

type TurnContext = Parameters<typeof workspaceForTurn>[0];

/**
 * Sentry org, project and token for this turn's workspace. The workspace is authoritative: a
 * model-supplied org/project never selects which credentials are used.
 */
export async function sentryAccess(ctx: TurnContext): Promise<SentryAccess> {
  const resolved = await workspaceForTurn(ctx);
  const connection = findConnection(resolved, "sentry");
  const config = (connection?.config ?? {}) as { org?: string; project?: string };
  const token = tokenFor(resolved, connection, process.env.SENTRY_AUTH_TOKEN);
  if (!connection || !config.org) {
    return {
      ok: false,
      error: "no_sentry_connection",
      message: "This workspace has no Sentry connection yet. Ask the team to connect Sentry in Roary's setup.",
    };
  }
  if (!token) {
    return {
      ok: false,
      error: "sentry_token_missing",
      message: "This workspace's Sentry connection has no token yet. Ask the team to finish connecting Sentry.",
    };
  }
  return { ok: true, org: config.org, project: config.project, token, workspaceId: resolved.workspace.id };
}
