import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let instance: NeonAuth | null | undefined;

/**
 * Neon Auth (Managed Better Auth), or null when its env is missing. Built lazily:
 * createNeonAuth throws without a cookie secret, and a throw at import time would
 * take down /api/profiles and the guest hire with it.
 */
export function getAuth(): NeonAuth | null {
  if (instance !== undefined) return instance;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  instance = baseUrl && secret ? createNeonAuth({ baseUrl, cookies: { secret } }) : null;
  return instance;
}

/** The signed-in user's id from the session cookie, or null for guests (and on any auth error). */
export async function getSessionUserId(): Promise<string | null> {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const { data: session } = await auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
