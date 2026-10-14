import { getAuth } from "@/lib/auth/server";

// Proxies every Neon Auth call (sign-up, sign-in, session, sign-out) to the branch's Auth URL.
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type Context = { params: Promise<{ path: string[] }> };

function forward(method: Method) {
  return (request: Request, context: Context): Promise<Response> | Response => {
    const auth = getAuth();
    if (!auth) return Response.json({ error: "Sign-in is not set up here." }, { status: 503 });
    return auth.handler()[method](request, context);
  };
}

export const GET = forward("GET");
export const POST = forward("POST");
export const PUT = forward("PUT");
export const DELETE = forward("DELETE");
export const PATCH = forward("PATCH");
