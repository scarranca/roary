import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { Principal } from "./workspace";

// Web chat ownership. eve's route auth admits a caller but never checks that a session is
// theirs ("session ownership remains an application policy"), so agent/channels/eve.ts asks
// this module before any /eve/v1/session/:id route runs.

/** The authenticator agent/channels/eve.ts stamps on a browser with a verified guest cookie. */
export const GUEST_AUTHENTICATOR = "roary-guest";

/** Stable owner identity for a caller: `<authenticator>:<principalId>`. */
export function ownerKey(principal: NonNullable<Principal>): string {
  return `${principal.authenticator}:${principal.principalId}`;
}

// Ids eve hands out look like `wrun_...`; refuse anything else before it reaches a query.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The session id addressed by an eve session route, e.g. /eve/v1/session/<id>/stream. */
export function sessionIdFromPath(pathname: string): string | null | undefined {
  const match = /^\/eve\/v1\/session\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match) return undefined; // not a session-scoped route
  const id = decodeURIComponent(match[1]!);
  return SESSION_ID.test(id) ? id : null; // null: malformed id, reject
}

// Owners never change, so remember them per instance instead of querying on every reconnect.
const owners = new Map<string, string>();
function remember(sessionId: string, owner: string): string {
  if (owners.size > 5_000) owners.delete(owners.keys().next().value!);
  owners.set(sessionId, owner);
  return owner;
}

export async function findOwner(sessionId: string): Promise<string | undefined> {
  const cached = owners.get(sessionId);
  if (cached) return cached;
  const [row] = await db
    .select({ ownerKey: schema.chatSessions.ownerKey })
    .from(schema.chatSessions)
    .where(eq(schema.chatSessions.sessionId, sessionId))
    .limit(1);
  return row ? remember(sessionId, row.ownerKey) : undefined;
}

export async function findSession(sessionId: string) {
  const [row] = await db.select().from(schema.chatSessions).where(eq(schema.chatSessions.sessionId, sessionId)).limit(1);
  return row;
}

/**
 * Records `owner` for a session that has none yet and returns whoever owns it now. The first
 * caller to touch a new session id claims it; that is its creator, the only one eve gave the id
 * to (the create response). The eve channel's turn.started handler records the session
 * initiator the same way, so a session nobody streamed is still claimed.
 */
export async function claimSession(sessionId: string, owner: string, workspaceId: number | null): Promise<string> {
  const existing = await findOwner(sessionId);
  if (existing) return existing;
  await db
    .insert(schema.chatSessions)
    .values({ sessionId, ownerKey: owner, workspaceId })
    .onConflictDoNothing({ target: schema.chatSessions.sessionId });
  return (await findOwner(sessionId)) ?? owner;
}
