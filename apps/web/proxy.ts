import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GUEST_COOKIE, newGuestId, signGuestId, verifyGuestCookie } from "../../agent/lib/crypto";

export function proxy(request: NextRequest) {
  const routerHost = process.env.VERCEL_URL;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (process.env.__VERCEL_DEV_RUNNING === "1" && routerHost && forwardedHost !== routerHost) {
    const target = request.nextUrl.clone();
    target.protocol = "http:";
    target.host = routerHost;
    return NextResponse.redirect(target);
  }
  const response = NextResponse.next();
  withGuestCookie(request, response);
  return response;
}

/**
 * Every browser gets a signed guest id (httpOnly, a year) on its first page load. The eve channel
 * (agent/channels/eve.ts) reads it: a guest owns the chats they start, and guest limits count
 * per id. Signed-in people keep theirs too, so chats started before signing in stay theirs.
 */
function withGuestCookie(request: NextRequest, response: NextResponse) {
  if (verifyGuestCookie(request.cookies.get(GUEST_COOKIE)?.value)) return;
  let value: string;
  try {
    value = signGuestId(newGuestId());
  } catch {
    return; // CONNECTIONS_ENCRYPTION_KEY missing: no guest identity (eve then refuses guests)
  }
  response.cookies.set(GUEST_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const config = {
  // Pages and API routes; not Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
