import { cookies } from "next/headers";
import { getSessionUserId } from "@/lib/auth/server";

/**
 * Whether this browser may open /desk/s/<sessionId>. The eve channel enforces the same rule on
 * every session route (agent/channels/eve.ts); checking here too turns someone else's link into
 * a 404 page instead of an empty chat. A session with no owner yet (just created) is allowed.
 */
export async function canOpenChat(sessionId: string): Promise<boolean> {
  const { findOwner, sessionIdFromPath, GUEST_AUTHENTICATOR } = await import("../../../agent/lib/chat-sessions");
  if (!sessionIdFromPath(`/eve/v1/session/${encodeURIComponent(sessionId)}`)) return false;
  let owner: string | undefined;
  try {
    owner = await findOwner(sessionId);
  } catch {
    return true; // database hiccup: let the eve channel decide
  }
  if (!owner) return true;

  const { GUEST_COOKIE, verifyGuestCookie } = await import("../../../agent/lib/crypto");
  const { NEON_AUTH_AUTHENTICATOR } = await import("../../../agent/lib/workspace");
  const keys: string[] = [];
  const userId = await getSessionUserId();
  if (userId) keys.push(`${NEON_AUTH_AUTHENTICATOR}:${userId}`);
  const guestId = verifyGuestCookie((await cookies()).get(GUEST_COOKIE)?.value);
  if (guestId) keys.push(`${GUEST_AUTHENTICATOR}:${guestId}`);
  return keys.includes(owner);
}
