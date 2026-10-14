import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { type AuthFn, extractBearerToken, UnauthenticatedError, withAuthChallenges } from "eve/channels/auth";
import { NEON_AUTH_AUTHENTICATOR } from "./workspace";

// Neon Auth (Managed Better Auth) issues 15-minute EdDSA JWTs whose `iss` and `aud` are the
// origin of NEON_AUTH_BASE_URL. The browser gets one from `authClient.token()` and sends it as
// a bearer; we verify it against the branch's JWKS, so a client can never pick its own id.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function neonAuthConfig(): { issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) return null;
  jwks ??= createRemoteJWKSet(new URL(`${base.replace(/\/$/, "")}/.well-known/jwks.json`));
  return { issuer: new URL(base).origin, jwks };
}

/**
 * Route auth for signed-in Roary users. Skips (returns null) when there is no bearer or the
 * bearer isn't a Neon Auth token, so Vercel OIDC, localDev and anonymous callers fall through.
 * A Neon Auth token that fails verification (expired, forged) is rejected with a 401 instead
 * of silently degrading to the guest workspace.
 */
export function neonAuth(): AuthFn<Request> {
  return withAuthChallenges(
    async (request: Request) => {
      const config = neonAuthConfig();
      const token = extractBearerToken(request.headers.get("authorization"));
      if (!config || !token) return null;

      let issuer: string | undefined;
      try {
        issuer = decodeJwt(token).iss;
      } catch {
        return null; // not a JWT at all
      }
      if (issuer !== config.issuer) return null;

      try {
        const { payload } = await jwtVerify(token, config.jwks, {
          issuer: config.issuer,
          audience: config.issuer,
          algorithms: ["EdDSA"],
        });
        if (typeof payload.sub !== "string" || !payload.sub) throw new Error("missing sub");
        return {
          authenticator: NEON_AUTH_AUTHENTICATOR,
          issuer: config.issuer,
          principalId: payload.sub,
          principalType: "user",
          subject: payload.sub,
          attributes: (typeof payload.email === "string" ? { email: payload.email } : {}) as Record<string, string>,
        };
      } catch {
        throw new UnauthenticatedError({
          code: "invalid_session",
          message: "Your sign-in expired. Refresh the page and try again.",
        });
      }
    },
    [{ scheme: "Bearer" }],
  );
}
