import { type NextRequest, NextResponse } from "next/server";
import { checkState, NONCE_COOKIE } from "@/lib/connections/github-state";
import { claimGithubInstallation, markGithubPending } from "@/lib/connections/service";
import { getCurrentWorkspace } from "@/lib/connections/workspace";

// GitHub App "Setup URL": GitHub sends the browser here after an install or update with
// ?installation_id=…&setup_action=install|update|request&state=…
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

  const state = checkState(params.get("state"), request.cookies.get(NONCE_COOKIE)?.value);
  if (!state.ok) return finish("error", `state_${state.reason}`);

  // The state must belong to whoever is signed in now, not just to someone.
  const workspace = await getCurrentWorkspace();
  if (workspace.kind === "demo" || workspace.id !== state.workspaceId) return finish("error", "state_workspace");

  const setupAction = params.get("setup_action");
  const installationId = params.get("installation_id");
  try {
    if (setupAction === "request" && !installationId) {
      await markGithubPending(workspace.id);
      return finish("pending");
    }
    if (!installationId) return finish("error", "no_installation");
    const result = await claimGithubInstallation(workspace.id, installationId);
    return result.ok ? finish("connected") : finish("error", result.code);
  } catch (error) {
    console.error("github callback failed", error instanceof Error ? error.name : "unknown");
    return finish("error", "server");
  }
}
