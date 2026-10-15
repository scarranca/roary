import { type NextRequest, NextResponse } from "next/server";
import { hasEncryptionKey } from "../../../../../../../agent/lib/crypto";
import { NONCE_COOKIE, STATE_TTL_MS, startInstall } from "@/lib/connections/github-state";
import { githubConnectEnabled } from "@/lib/connections/github-user";
import { getUserWorkspace } from "@/lib/connections/workspace";

// "Install Roary on your repos": off to GitHub with a state bound to this workspace.
export async function GET(request: NextRequest) {
  const back = new URL("/settings/connections", request.nextUrl.origin);
  if (!githubConnectEnabled() || !hasEncryptionKey()) {
    back.searchParams.set("github", "unavailable");
    return NextResponse.redirect(back);
  }
  const workspace = await getUserWorkspace();
  if (!workspace) {
    back.searchParams.set("github", "signin");
    return NextResponse.redirect(back);
  }
  const { nonce, url } = startInstall(workspace.id);
  const response = NextResponse.redirect(url);
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax", // GitHub's redirect back is a top-level GET.
    secure: request.nextUrl.protocol === "https:",
    path: "/api/connect/github",
    maxAge: STATE_TTL_MS / 1000,
  });
  return response;
}
