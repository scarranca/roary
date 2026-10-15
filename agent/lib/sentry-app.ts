import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";

// Roary as a Sentry *public* integration (a "Sentry App" any org can install): the HTTP side,
// no database, no Next or eve imports (agent/lib/sentry-app-store.ts has the `connections` side).
// Shared by the web app (install redirect → grant-code exchange) and the agent (webhooks, refresh).
// Endpoints, checked against Sentry's integration-platform docs and source:
// - install page:   https://sentry.io/sentry-apps/<slug>/external-install/   (passes `state` through)
// - redirect URL:   ?code=…&installationId=<uuid>&orgSlug=…&state=…
// - token exchange: POST /api/0/sentry-app-installations/<uuid>/authorizations/
//                   {grant_type: "authorization_code", code, client_id, client_secret}
// - token refresh:  same endpoint, {grant_type: "urn:sentry:params:oauth:grant-type:jwt-bearer"} with
//                   `Authorization: Bearer <HS256 JWT signed with the client secret>` (Sentry's
//                   recommended manual refresh; unlike a one-shot refresh token, a lost race can't
//                   brick the connection)
// - verify install: PUT /api/0/sentry-app-installations/<uuid>/ {status: "installed"}
// - webhooks:       `sentry-hook-signature` = HMAC-SHA256(client secret, body), hex
// Tokens expire every 8 hours.
//
// Everything here is off unless SENTRY_PUBLIC_INTEGRATION_ENABLED=1.

export const SENTRY_API = "https://sentry.io/api/0";
const TIMEOUT_MS = 10_000;
const JWT_BEARER = "urn:sentry:params:oauth:grant-type:jwt-bearer";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sentryPublicEnabled(): boolean {
  const flag = process.env.SENTRY_PUBLIC_INTEGRATION_ENABLED;
  return flag === "1" || flag === "true";
}

export type SentryAppCredentials = { slug: string; clientId: string; clientSecret: string };

/** The public app's settings, or null when the flag is off or any of them is missing. */
export function sentryAppCredentials(): SentryAppCredentials | null {
  if (!sentryPublicEnabled()) return null;
  const slug = process.env.SENTRY_APP_SLUG?.trim();
  const clientId = process.env.SENTRY_CLIENT_ID?.trim();
  const clientSecret = process.env.SENTRY_CLIENT_SECRET?.trim();
  return slug && clientId && clientSecret ? { slug, clientId, clientSecret } : null;
}

export function sentryInstallUrl(slug: string, state: string): string {
  const url = new URL(`https://sentry.io/sentry-apps/${encodeURIComponent(slug)}/external-install/`);
  url.searchParams.set("state", state);
  return url.toString();
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** `sentry-hook-signature`: HMAC-SHA256(secret, body) in hex. */
export function verifySentrySignature(raw: string, parsed: unknown, signature: string, secret: string): boolean {
  if (!signature) return false;
  const sign = (payload: string) => createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  // Sentry's own examples sign JSON.stringify(body); check the raw bytes too in case they differ.
  return safeEqual(sign(raw), signature) || safeEqual(sign(JSON.stringify(parsed)), signature);
}

export type IssueRef = { id: string; shortId?: string; title: string; project?: string };

/** `issue` resource (action "created") or an `event_alert` from an issue alert rule action. */
export function issueFromPayload(resource: string | null, body: any): IssueRef | null {
  if (resource === "issue" && body?.action === "created" && body.data?.issue?.id) {
    const issue = body.data.issue;
    return { id: String(issue.id), shortId: issue.shortId, title: issue.title ?? "Untitled error", project: issue.project?.slug };
  }
  if (resource === "event_alert" && body?.data?.event?.issue_id) {
    const event = body.data.event;
    return { id: String(event.issue_id), title: event.title ?? "Untitled error", project: event.project_slug ?? undefined };
  }
  return null;
}

/** Non-secret routing stored in `connections.config` for a Sentry App install. */
export type SentryAppConfig = { org: string; project?: string; installationUuid: string; expiresAt: string; source: "sentry-app" };

export function sentryAppConfig(connection: { provider: string; config: unknown }): SentryAppConfig | null {
  const config = (connection.config ?? {}) as Partial<SentryAppConfig>;
  return connection.provider === "sentry" && config.source === "sentry-app" && typeof config.installationUuid === "string"
    ? (config as SentryAppConfig)
    : null;
}

// ---- tokens -------------------------------------------------------------------------------

export class SentryAppError extends Error {
  constructor(readonly code: string) {
    super(`Sentry app: ${code}`);
    this.name = "SentryAppError";
  }
}

type TokenResponse = { token: string; expiresAt: string };

async function postAuthorization(installationUuid: string, body: object, headers: Record<string, string> = {}): Promise<TokenResponse> {
  const response = await fetch(`${SENTRY_API}/sentry-app-installations/${installationUuid}/authorizations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new SentryAppError(`token_http_${response.status}`);
  const json = (await response.json()) as { token?: unknown; expiresAt?: unknown };
  if (typeof json.token !== "string" || !json.token) throw new SentryAppError("token_missing");
  const expiresAt =
    typeof json.expiresAt === "string" && !Number.isNaN(Date.parse(json.expiresAt))
      ? json.expiresAt
      : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  return { token: json.token, expiresAt };
}

/** Grant code (single use, short-lived) → the installation's first token. */
export function exchangeGrantCode(app: SentryAppCredentials, installationUuid: string, code: string): Promise<TokenResponse> {
  return postAuthorization(installationUuid, {
    grant_type: "authorization_code",
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
  });
}

/** A fresh token for an installation, via Sentry's client-secret JWT grant. */
export async function refreshInstallationToken(app: SentryAppCredentials, installationUuid: string): Promise<TokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(app.clientId)
    .setSubject(app.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(app.clientSecret));
  return postAuthorization(installationUuid, { grant_type: JWT_BEARER }, { Authorization: `Bearer ${jwt}` });
}
