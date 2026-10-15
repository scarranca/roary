import { type NextRequest, NextResponse } from "next/server";
import { hasEncryptionKey } from "../../../../../../../agent/lib/crypto";
import { sentryAppCredentials } from "../../../../../../../agent/lib/sentry-app";
import { STATE_TTL_MS } from "@/lib/connections/github-state";
import { SENTRY_COOKIE_PATH, SENTRY_NONCE_COOKIE, startSentryInstall } from "@/lib/connections/sentry-state";
import { getUserWorkspace } from "@/lib/connections/workspace";

// "Install Roary in Sentry": off to Sentry's install page for the public app, with a state bound
// to this workspace. Only with SENTRY_PUBLIC_INTEGRATION_ENABLED=1 and the app's env set.
export async function GET(request: NextRequest) {
  const back = new URL("/settings/connections", request.nextUrl.origin);
  const app = sentryAppCredentials();
  if (!app || !hasEncryptionKey()) {
    back.searchParams.set("sentry", "unavailable");
    return NextResponse.redirect(back);
  }
  const workspace = await getUserWorkspace();
  if (!workspace) {
    back.searchParams.set("sentry", "signin");
    return NextResponse.redirect(back);
  }
  const { nonce, url } = startSentryInstall(workspace.id, app.slug);
  const response = NextResponse.redirect(url);
  response.cookies.set(SENTRY_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax", // Sentry's redirect back is a top-level GET.
    secure: request.nextUrl.protocol === "https:",
    path: SENTRY_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000,
  });
  return response;
}
