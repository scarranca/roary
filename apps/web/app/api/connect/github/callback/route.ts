import { type NextRequest, NextResponse } from "next/server";
import { checkState, NONCE_COOKIE } from "@/lib/connections/github-state";
import { githubConnectEnabled, githubUserToken, userCanAccessInstallation } from "@/lib/connections/github-user";
import { claimGithubInstallation, markGithubPending } from "@/lib/connections/service";
import { getUserWorkspace } from "@/lib/connections/workspace";

// GitHub App "Setup URL": GitHub sends the browser here after an install or update with
// ?installation_id=…&setup_action=install|update|request&state=…
//
// Binding an installation needs three proofs: the signed state + nonce cookie (this browser
// started the install), the state's workspace is the signed-in user's, and the user's own
// GitHub token can access that installation (GET /user/installations, via Vercel Connect).
// Without a user token yet, we send them through Connect's GitHub authorization and Connect
// returns them to this exact URL.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = new URL("/settings/connections", request.nextUrl.origin);
  const finish = (outcome: string, detail?: string) => {
    back.searchParams.set("github", outcome);
    if (detail) back.searchParams.set("detail", detail);
    const response = NextResponse.redirect(back);
    response.cookies.delete({ name: NONCE_COOKIE, path: "/api/connect/github" });
    return response;
  };

  if (!githubConnectEnabled()) return finish("unavailable");

  const state = checkState(params.get("state"), request.cookies.get(NONCE_COOKIE)?.value);
  if (!state.ok) return finish("error", `state_${state.reason}`);

  // The state must belong to whoever is signed in now, not just to someone.
  const workspace = await getUserWorkspace();
  if (!workspace || workspace.id !== state.workspaceId) return finish("error", "state_workspace");

  const setupAction = params.get("setup_action");
  const installationId = params.get("installation_id");
  try {
    if (setupAction === "request" && !installationId) {
      await markGithubPending(workspace.id);
      return finish("pending");
    }
    if (!installationId) return finish("error", "no_installation");

    const user = await githubUserToken(workspace.userId, request.nextUrl.toString());
    // Keep the nonce cookie: the browser comes back here after GitHub's OAuth screen.
    if (user.kind === "authorize") return NextResponse.redirect(user.url);
    const access = await userCanAccessInstallation(user.token, installationId);
    if (!access.ok) return finish("error", access.code);

    const result = await claimGithubInstallation(workspace.id, installationId);
    return result.ok ? finish("connected") : finish("error", result.code);
  } catch (error) {
    console.error("github callback failed", error instanceof Error ? error.name : "unknown");
    return finish("error", "server");
  }
}
