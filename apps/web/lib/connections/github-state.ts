import { randomBytes } from "node:crypto";
import { signPayload, verifyPayload } from "./crypto";
import { GITHUB_APP_SLUG } from "./validate";

// The GitHub App install round trip: a signed `state` names the workspace, and a
// matching nonce cookie proves the callback lands in the browser that started it.

export const NONCE_COOKIE = "roary_gh_install";
export const STATE_TTL_MS = 15 * 60 * 1000;

type State = { w: number; n: string; e: number };

export function startInstall(workspaceId: number) {
  const nonce = randomBytes(16).toString("base64url");
  const state = signPayload({ w: workspaceId, n: nonce, e: Date.now() + STATE_TTL_MS } satisfies State);
  const url = new URL(`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set("state", state);
  return { nonce, url: url.toString() };
}

export type StateCheck = { ok: true; workspaceId: number } | { ok: false; reason: "missing" | "invalid" | "expired" | "browser" };

export function checkState(state: string | null, nonceCookie: string | undefined): StateCheck {
  if (!state) return { ok: false, reason: "missing" };
  const payload = verifyPayload<State>(state);
  if (!payload || typeof payload.w !== "number" || typeof payload.n !== "string") return { ok: false, reason: "invalid" };
  if (payload.e < Date.now()) return { ok: false, reason: "expired" };
  if (!nonceCookie || nonceCookie !== payload.n) return { ok: false, reason: "browser" };
  return { ok: true, workspaceId: payload.w };
}
