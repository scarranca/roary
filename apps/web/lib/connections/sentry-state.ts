import { randomBytes } from "node:crypto";
import { signPayload } from "../../../../agent/lib/crypto";
import { sentryInstallUrl } from "../../../../agent/lib/sentry-app";
import { STATE_TTL_MS } from "./github-state";

// The Sentry App install round trip, same shape as GitHub's (./github-state.ts): a signed `state`
// names the workspace and a nonce cookie scoped to /api/connect/sentry proves the redirect lands
// in the browser that started it. Sentry's external-install page passes `state` through to the
// redirect URL. Checked with checkState() from ./github-state.

export const SENTRY_NONCE_COOKIE = "roary_sentry_install";
export const SENTRY_COOKIE_PATH = "/api/connect/sentry";

export function startSentryInstall(workspaceId: number, appSlug: string) {
  const nonce = randomBytes(16).toString("base64url");
  const state = signPayload({ w: workspaceId, n: nonce, e: Date.now() + STATE_TTL_MS });
  return { nonce, url: sentryInstallUrl(appSlug, state) };
}
