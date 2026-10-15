import { type NextRequest, NextResponse } from "next/server";
import { sentryAppCredentials } from "../../../../../../../agent/lib/sentry-app";
import { checkState } from "@/lib/connections/github-state";
import { SENTRY_COOKIE_PATH, SENTRY_NONCE_COOKIE } from "@/lib/connections/sentry-state";
import { getUserWorkspace } from "@/lib/connections/workspace";

// The Sentry App's Redirect URL: after an install Sentry sends the browser here with
// ?code=…&installationId=<uuid>&orgSlug=…&state=…
//
// Binding needs the signed state + nonce cookie (this browser started the install from Roary),
// the state's workspace to be the signed-in user's, and a successful exchange of the single-use
// grant code (only the real install's redirect and webhook ever carry it).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = new URL("/settings/connections", request.nextUrl.origin);
  const finish = (outcome: string, detail?: string) => {
    back.searchParams.set("sentry", outcome);
    if (detail) back.searchParams.set("detail", detail);
    const response = NextResponse.redirect(back);
    response.cookies.delete({ name: SENTRY_NONCE_COOKIE, path: SENTRY_COOKIE_PATH });
    return response;
  };

  if (!sentryAppCredentials()) return finish("unavailable");
  // Installed from Sentry's own Integrations page: nothing ties it to a Roary workspace.
  if (!params.get("state")) return finish("start_here");

  const state = checkState(params.get("state"), request.cookies.get(SENTRY_NONCE_COOKIE)?.value);
  if (!state.ok) return finish("error", `state_${state.reason}`);

  const workspace = await getUserWorkspace();
  if (!workspace || workspace.id !== state.workspaceId) return finish("error", "state_workspace");

  const installationUuid = params.get("installationId");
  const code = params.get("code");
  if (!installationUuid || !code) return finish("error", "no_installation");
  try {
    // Imported lazily, like the rest of the web app's database access.
    const { claimSentryInstallation } = await import("../../../../../../../agent/lib/sentry-app-store");
    const result = await claimSentryInstallation(workspace.id, {
      installationUuid,
      code,
      orgSlug: params.get("orgSlug") ?? undefined,
    });
    return result.ok ? finish("connected") : finish("error", result.code);
  } catch (error) {
    console.error("sentry callback failed", error instanceof Error ? error.name : "unknown");
    return finish("error", "server");
  }
}
