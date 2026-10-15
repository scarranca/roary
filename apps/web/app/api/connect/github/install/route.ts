import { type NextRequest, NextResponse } from "next/server";
import { hasEncryptionKey } from "@/lib/connections/crypto";
import { NONCE_COOKIE, STATE_TTL_MS, startInstall } from "@/lib/connections/github-state";
import { getCurrentWorkspace } from "@/lib/connections/workspace";

// "Install Roary on your repos": off to GitHub with a state bound to this workspace.
export async function GET(request: NextRequest) {
  const back = new URL("/settings/connections", request.nextUrl.origin);
  const workspace = await getCurrentWorkspace();
  if (workspace.kind === "demo") {
    back.searchParams.set("github", "signin");
    return NextResponse.redirect(back);
  }
  if (!hasEncryptionKey()) {
    back.searchParams.set("github", "unavailable");
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
