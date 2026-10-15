import { claimSession, findSession, GUEST_AUTHENTICATOR, ownerKey } from "./chat-sessions";
import { recordUsage, type StepUsage } from "./usage-limits";
import { type Principal, resolveWorkspace } from "./workspace";

// Channel event handlers shared by the web chat (agent/channels/eve.ts) and the quick-connect
// webhook channels, so every session has an owner and its model spend lands on its workspace.

type SessionCtx = { readonly session: { readonly id: string; readonly auth: { readonly initiator: Principal } } };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export async function workspaceIdFor(principal: Principal): Promise<number | null> {
  try {
    return (await resolveWorkspace(principal)).workspace.id;
  } catch {
    return null;
  }
}

/** turn.started: the initiator owns the session even if nobody ever streams it (a no-op once claimed). */
export async function claimTurnOwner(ctx: SessionCtx): Promise<void> {
  const initiator = ctx.session.auth.initiator;
  if (!initiator) return;
  try {
    await claimSession(ctx.session.id, ownerKey(initiator), await workspaceIdFor(initiator));
  } catch (error) {
    console.warn("chat ownership not recorded", { sessionId: ctx.session.id, error: errorName(error) });
  }
}

/** step.completed: model spend per workspace (and per guest), as AI Gateway reports it on each model call. */
export async function recordStepSpend(data: { readonly usage?: StepUsage }, ctx: SessionCtx): Promise<void> {
  if (!data.usage) return;
  try {
    const row = await findSession(ctx.session.id);
    const owner = row?.ownerKey ?? (ctx.session.auth.initiator ? ownerKey(ctx.session.auth.initiator) : "");
    const workspaceId = row?.workspaceId ?? (await workspaceIdFor(ctx.session.auth.initiator));
    const scopes: string[] = [];
    if (workspaceId !== null) scopes.push(`ws:${workspaceId}`);
    if (owner.startsWith(`${GUEST_AUTHENTICATOR}:`)) scopes.push(`guest:${owner.slice(GUEST_AUTHENTICATOR.length + 1)}`);
    await recordUsage(scopes, data.usage);
  } catch (error) {
    console.warn("model usage not recorded", { sessionId: ctx.session.id, error: errorName(error) });
  }
}
