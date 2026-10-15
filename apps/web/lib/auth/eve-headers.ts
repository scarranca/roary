"use client";

import { authClient } from "./client";

// Neon Auth JWTs live 15 minutes; reuse one until a minute before it expires.
let cached: { token: string; expiresAt: number } | null = null;

/** Forget the cached JWT (call on sign-out, so the next eve request goes out as a guest). */
export function clearEveAuthCache() {
  cached = null;
}

function expiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Headers for every eve request from the browser. A signed-in person sends their Neon Auth JWT
 * so agent/channels/eve.ts runs the turn in their workspace; guests send nothing and get the
 * demo workspace. eve verifies the token server-side; the browser never sends a user id.
 */
export async function eveAuthHeaders(): Promise<Record<string, string>> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return { authorization: `Bearer ${cached.token}` };
  cached = null;
  try {
    const { data } = await authClient.token();
    if (!data?.token) return {};
    cached = { token: data.token, expiresAt: expiry(data.token) };
    return { authorization: `Bearer ${data.token}` };
  } catch {
    return {};
  }
}
