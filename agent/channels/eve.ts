import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import {
  type AuthFn,
  type AuthResult,
  ForbiddenError,
  localDev,
  UnauthenticatedError,
  vercelOidc,
  withAuthChallenges,
} from "eve/channels/auth";
import { claimSession, findOwner, findSession, GUEST_AUTHENTICATOR, ownerKey, sessionIdFromPath } from "../lib/chat-sessions";
import { GUEST_COOKIE, readCookie, verifyGuestCookie } from "../lib/crypto";
import { neonAuth } from "../lib/neon-auth";
import { checkAndCountMessage, guestPolicy, type LimitPolicy, recordUsage, workspacePolicy } from "../lib/usage-limits";
import { getDemoWorkspace, NEON_AUTH_AUTHENTICATOR, type Principal, resolveWorkspace } from "../lib/workspace";
import { workspaceContext } from "../lib/workspace-context";

/** A browser with a valid `roary_guest` cookie (set by apps/web/proxy.ts): a guest who owns their chats. */
function guestCookie(): AuthFn<Request> {
  return (request) => {
    const id = verifyGuestCookie(readCookie(request.headers.get("cookie"), GUEST_COOKIE));
    return id ? { authenticator: GUEST_AUTHENTICATOR, principalId: id, principalType: "anonymous", attributes: {} } : null;
  };
}

// Who is calling, in order. There is no `none()`: an anonymous caller must carry a guest cookie,
// so every chat has an owner (the web app sets one on the first page load).
const identify: AuthFn<Request>[] = [
  // Signed-in Roary users (Neon Auth JWT as a bearer): their own workspace.
  neonAuth(),
  // Lets the eve TUI and your Vercel deployments reach the deployed agent.
  vercelOidc(),
  // Guests from the browser: the demo workspace, their own chats, guest limits.
  guestCookie(),
  // Open on localhost for `eve dev` and the REPL; ignored in production.
  localDev(),
];

/** eve's own runtime and team deployments (Vercel OIDC service tokens) skip ownership checks. */
function isInfrastructure(caller: AuthResult): boolean {
  return caller.authenticator === "oidc" && (caller.principalType === "service" || caller.principalType === "runtime");
}

class HttpError extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
  }
}

function notYours(): never {
  throw new ForbiddenError({
    code: "session_forbidden",
    message: "This chat belongs to someone else. Start a new one from Roary's desk.",
  });
}

/** Everyone this request can prove to be: the route principal, plus a guest cookie it also carries. */
function ownerKeys(request: Request, caller: AuthResult): string[] {
  const keys = [ownerKey(caller)];
  const guestId = verifyGuestCookie(readCookie(request.headers.get("cookie"), GUEST_COOKIE));
  // A guest who signs in keeps the chats they started as a guest in this browser.
  if (guestId) keys.push(`${GUEST_AUTHENTICATOR}:${guestId}`);
  return keys;
}

async function workspaceIdFor(principal: Principal): Promise<number | null> {
  try {
    return (await resolveWorkspace(principal)).workspace.id;
  } catch {
    return null;
  }
}

let demoWorkspaceId: number | undefined;

async function limitPolicy(caller: AuthResult): Promise<LimitPolicy | null> {
  if (caller.authenticator === GUEST_AUTHENTICATOR) {
    demoWorkspaceId ??= (await getDemoWorkspace()).id;
    return guestPolicy(caller.principalId, demoWorkspaceId);
  }
  if (caller.authenticator === NEON_AUTH_AUTHENTICATOR) {
    return workspacePolicy((await resolveWorkspace(caller)).workspace.id);
  }
  return null; // localDev, the eve TUI and team deployments are not rate limited
}

/** True for a POST that carries a user message (not a bodyless prewarm or an approval answer). */
async function carriesMessage(request: Request): Promise<boolean> {
  try {
    const body = (await request.clone().json()) as { message?: unknown } | null;
    return body !== null && typeof body === "object" && body.message !== undefined && body.message !== null;
  } catch {
    return false;
  }
}

/**
 * Identifies the caller, then applies Roary's policy on top of route auth:
 * - every /eve/v1/session/:id route (send, stream, cancel, clear, compact, reset, subagent
 *   streams) is for the session's owner only;
 * - a new message counts against the caller's hourly/daily cap and daily budget, and is refused
 *   with a friendly 429 when one is full.
 */
const roaryAuth: AuthFn<Request> = withAuthChallenges(
  async (request: Request) => {
    let caller: AuthResult | null | undefined = null;
    for (const fn of identify) {
      caller = await fn(request);
      if (caller) break;
    }
    if (!caller) {
      throw new UnauthenticatedError({
        code: "guest_cookie_required",
        message: "Open Roary in your browser (roary-rho.vercel.app/desk) to start a chat.",
      });
    }

    const { pathname } = new URL(request.url);
    const sessionId = sessionIdFromPath(pathname);
    if (sessionId === null) notYours();
    if (sessionId && !isInfrastructure(caller)) {
      const keys = ownerKeys(request, caller);
      const owner =
        (await findOwner(sessionId)) ?? (await claimSession(sessionId, keys[0]!, await workspaceIdFor(caller)));
      if (!keys.includes(owner)) notYours();
    }

    const isSend =
      request.method === "POST" &&
      (pathname === "/eve/v1/session" || (sessionId !== undefined && /^\/eve\/v1\/session\/[^/]+\/?$/.test(pathname)));
    if (isSend && (await carriesMessage(request))) {
      const policy = await limitPolicy(caller);
      const decision = policy ? await checkAndCountMessage(policy) : { ok: true as const };
      if (!decision.ok) {
        const retryAfter = Math.max(1, Math.ceil((decision.resetsAt.getTime() - Date.now()) / 1000));
        throw new HttpError(
          Response.json(
            { ok: false, code: "rate_limited", error: decision.message, reason: decision.reason, resetsAt: decision.resetsAt.toISOString() },
            { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfter) } },
          ),
        );
      }
    }
    return caller;
  },
  [{ scheme: "Bearer" }],
);

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export default eveChannel({
  auth: roaryAuth,
  // Tell Roary which workspace this turn runs in and what it is connected to, so a signed-in
  // team with nothing connected hears that instead of getting the demo shop's data.
  async onMessage(ctx) {
    return { auth: defaultEveAuth(ctx), context: [await workspaceContext(ctx.eve.caller)] };
  },
  events: {
    // The initiator owns the session even if nobody ever streams it (a no-op once claimed).
    async "turn.started"(_data, _channel, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;
      try {
        await claimSession(ctx.session.id, ownerKey(initiator), await workspaceIdFor(initiator));
      } catch (error) {
        console.warn("chat ownership not recorded", { sessionId: ctx.session.id, error: errorName(error) });
      }
    },
    // Model spend per workspace (and per guest), as AI Gateway reports it on each model call.
    async "step.completed"(data, _channel, ctx) {
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
    },
  },
});
