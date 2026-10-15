// End-to-end checks for the public Sentry App (agent/lib/sentry-app*.ts, the /sentry/webhook
// channel, credentialFor's token refresh), with Sentry's API mocked and synthetic, correctly
// signed webhook payloads. Writes to a NON-production Neon branch and removes its rows after.
//
//   neon env pull --project-id young-surf-15904408 --branch dev-connect --file .env.devconnect
//   npx tsx --env-file=.env.devconnect scripts/sentry-public-integration-test.ts
//
// No real Sentry calls, no model calls, no eve dev. Secrets are random per run and never printed.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { jwtVerify } from "jose";

if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production" || !process.env.DATABASE_URL) {
  console.error("Refusing to run: point --env-file at a non-production Neon branch (NEON_BRANCH, DATABASE_URL).");
  process.exit(2);
}

// ---- environment for this run (random secrets, never printed) ------------------------------
const CLIENT_ID = `test-client-${randomBytes(4).toString("hex")}`;
const CLIENT_SECRET = randomBytes(32).toString("hex");
const DEMO_SECRET = randomBytes(32).toString("hex");
process.env.CONNECTIONS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.SENTRY_APP_SLUG = "roary-test";
process.env.SENTRY_CLIENT_ID = CLIENT_ID;
process.env.SENTRY_CLIENT_SECRET = CLIENT_SECRET;
process.env.SENTRY_WEBHOOK_SECRET = DEMO_SECRET;
delete process.env.SENTRY_AUTH_TOKEN; // the demo path's short-id lookup stays offline
const enable = (on: boolean) => {
  if (on) process.env.SENTRY_PUBLIC_INTEGRATION_ENABLED = "1";
  else delete process.env.SENTRY_PUBLIC_INTEGRATION_ENABLED;
};

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

// ---- mocked Sentry API ----------------------------------------------------------------------
const ORG = "acme-test";
const RUN = randomBytes(3).toString("hex").toUpperCase();
const VALID_CODES = new Map<string, string>(); // code → installation uuid
const sentryCalls: { method: string; path: string; body?: any; auth?: string }[] = [];
let tokenCounter = 0;
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const in8h = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== "sentry.io") return realFetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const auth = new Headers(init?.headers).get("authorization") ?? undefined;
  sentryCalls.push({ method, path: url.pathname, body, auth });

  const authz = url.pathname.match(/^\/api\/0\/sentry-app-installations\/([0-9a-f-]+)\/authorizations\/$/);
  if (authz && method === "POST") {
    const uuid = authz[1]!;
    if (body.grant_type === "authorization_code") {
      const ok = body.client_id === CLIENT_ID && body.client_secret === CLIENT_SECRET && VALID_CODES.get(body.code) === uuid;
      if (!ok) return json(401, { detail: "Invalid grant" });
      VALID_CODES.delete(body.code); // single use
      return json(201, { id: "1", token: `tok-${++tokenCounter}`, refreshToken: `rt-${tokenCounter}`, expiresAt: in8h(), state: null, application: null });
    }
    if (body.grant_type === "urn:sentry:params:oauth:grant-type:jwt-bearer") {
      try {
        const { payload } = await jwtVerify(auth!.replace(/^Bearer /, ""), new TextEncoder().encode(CLIENT_SECRET), { algorithms: ["HS256"] });
        if (payload.iss !== CLIENT_ID || payload.sub !== CLIENT_ID || !payload.jti || (payload.exp ?? 0) - (payload.iat ?? 0) > 60) {
          return json(403, { detail: "bad claims" });
        }
      } catch {
        return json(403, { detail: "Could not validate JWT" });
      }
      await new Promise((r) => setTimeout(r, 150)); // widen the race window for the concurrency check
      return json(201, { id: "2", token: `tok-${++tokenCounter}`, refreshToken: null, expiresAt: in8h(), state: null, application: null });
    }
    return json(403, { detail: "Invalid grant_type" });
  }
  const install = url.pathname.match(/^\/api\/0\/sentry-app-installations\/([0-9a-f-]+)\/$/);
  if (install && method === "GET") return json(200, { uuid: install[1], status: "installed", organization: { slug: ORG } });
  if (install && method === "PUT") return json(200, { uuid: install[1], status: "installed" });
  if (url.pathname === `/api/0/organizations/${ORG}/projects/`) return json(200, [{ slug: "web" }]);
  return json(404, { detail: "not mocked" });
}) as typeof fetch;

// ---- modules under test (after env is set) --------------------------------------------------
const { db, schema } = await import("../agent/lib/db");
const app = await import("../agent/lib/sentry-app");
const store = await import("../agent/lib/sentry-app-store");
const ws = await import("../agent/lib/workspace");
const { openConnectionSecret } = await import("../agent/lib/crypto");
const { checkState } = await import("../apps/web/lib/connections/github-state");
const { startSentryInstall } = await import("../apps/web/lib/connections/sentry-state");
const channel = (await import("../agent/channels/sentry-webhook")).default as unknown as {
  routes: { method: string; path: string; handler: (req: Request, args: any) => Promise<Response> }[];
};
const route = channel.routes.find((r) => r.method === "POST" && r.path === "/sentry/webhook")!;

// Webhook driver: a signed request, a fake `from().send()` that records what would start.
type Sent = { address: string; message: string; auth: any };
async function post(resource: string, body: object, secret: string | null): Promise<{ status: number; text: string; sent: Sent[] }> {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "sentry-hook-resource": resource };
  if (secret) headers["sentry-hook-signature"] = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const sent: Sent[] = [];
  const pending: Promise<unknown>[] = [];
  const response = await route.handler(new Request("https://roary.test/sentry/webhook", { method: "POST", headers, body: raw }), {
    from: (address: string) => ({
      send: async (message: string, options: { auth: unknown }) => {
        sent.push({ address, message, auth: options.auth });
      },
    }),
    waitUntil: (task: Promise<unknown>) => pending.push(task),
  });
  await Promise.all(pending);
  return { status: response.status, text: await response.text(), sent };
}

const issueBody = (installationUuid: string, issue: { id: string; shortId: string; title: string }) => ({
  action: "created",
  installation: { uuid: installationUuid },
  actor: { id: "sentry", name: "Sentry", type: "application" },
  data: { issue: { ...issue, project: { slug: "web" }, status: "unresolved" } },
});
const installationBody = (action: "created" | "deleted", uuid: string) => ({
  action,
  installation: { uuid },
  actor: { id: 1, name: "Test Person", type: "user" },
  data: { installation: { status: "pending", organization: { slug: ORG }, app: { uuid: randomUUID(), slug: "roary-test" }, code: "f3c71b491e3949b6b033ae45312a4fcb", uuid } },
});

// ---- fixtures ---------------------------------------------------------------------------------
const tag = `sentry-app-test-${RUN.toLowerCase()}`;
const [wsA] = await db.insert(schema.workspaces).values({ name: `${tag}-a`, ownerUserId: `${tag}-a` }).returning();
const [wsB] = await db.insert(schema.workspaces).values({ name: `${tag}-b`, ownerUserId: `${tag}-b` }).returning();
const workspaceIds = [wsA!.id, wsB!.id];
const uuidA = randomUUID();
const uuidB = randomUUID();
const shortId = `SAPPTEST-${RUN}-1`;
const demoShortId = `SAPPTEST-${RUN}-DEMO`;

try {
  // 1. Pure pieces
  enable(false);
  check("flag off → sentryAppCredentials() is null", app.sentryAppCredentials() === null);
  enable(true);
  check("flag on + env → credentials", app.sentryAppCredentials()?.clientId === CLIENT_ID);
  const raw = JSON.stringify({ hello: "sentry" });
  const good = createHmac("sha256", CLIENT_SECRET).update(raw).digest("hex");
  check("signature: HMAC-SHA256(client secret, body) verifies", app.verifySentrySignature(raw, JSON.parse(raw), good, CLIENT_SECRET));
  check("signature: other secret fails", !app.verifySentrySignature(raw, JSON.parse(raw), good, DEMO_SECRET));
  check("signature: empty fails", !app.verifySentrySignature(raw, JSON.parse(raw), "", CLIENT_SECRET));

  const { nonce, url } = startSentryInstall(wsA!.id, "roary-test");
  const installUrl = new URL(url);
  check("install URL is Sentry's external-install page for the slug", installUrl.origin + installUrl.pathname === "https://sentry.io/sentry-apps/roary-test/external-install/");
  const state = checkState(installUrl.searchParams.get("state"), nonce);
  check("install state round-trips to the workspace", state.ok && state.workspaceId === wsA!.id);
  check("install state needs this browser's nonce", !checkState(installUrl.searchParams.get("state"), "other").ok);

  // 2. Install: grant-code exchange → encrypted token in the workspace's connection
  check("bad grant code → refused, nothing stored", (await store.claimSentryInstallation(wsA!.id, { installationUuid: uuidA, code: "0".repeat(32) })).ok === false);
  const codeA = randomBytes(16).toString("hex");
  VALID_CODES.set(codeA, uuidA);
  const claimA = await store.claimSentryInstallation(wsA!.id, { installationUuid: uuidA, code: codeA, orgSlug: "ignored-query-org" });
  check("valid grant code → connected", claimA.ok && claimA.org === ORG && claimA.project === "web");
  const exchange = sentryCalls.find((c) => c.path.endsWith(`/${uuidA}/authorizations/`) && c.body?.code === codeA);
  check("exchange POSTs authorization_code with client_id + client_secret", exchange?.body?.grant_type === "authorization_code" && exchange.body.client_id === CLIENT_ID && exchange.body.client_secret === CLIENT_SECRET);
  check("install verified with PUT {status: installed}", sentryCalls.some((c) => c.method === "PUT" && c.path === `/api/0/sentry-app-installations/${uuidA}/` && c.body?.status === "installed"));
  const [rowA] = await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, wsA!.id));
  const configA = rowA?.config as Record<string, unknown>;
  check("row: provider sentry, status connected, org from Sentry (not the query string)", rowA?.provider === "sentry" && rowA.status === "connected" && configA.org === ORG);
  check("row: config has installationUuid + source, no token", configA.installationUuid === uuidA && configA.source === "sentry-app" && !JSON.stringify(configA).includes("tok-"));
  check("row: token stored encrypted (v1 ciphertext) and decrypts", !!rowA?.secretCiphertext?.startsWith("v1.") && !rowA.secretCiphertext.includes("tok-1") && openConnectionSecret({ ...rowA, secretCiphertext: rowA.secretCiphertext }) === "tok-1");
  const codeReplay = await store.claimSentryInstallation(wsA!.id, { installationUuid: uuidA, code: codeA });
  check("grant code is single use", codeReplay.ok === false);
  const codeSteal = randomBytes(16).toString("hex");
  VALID_CODES.set(codeSteal, uuidA);
  check("another workspace can't claim a connected installation", (await store.claimSentryInstallation(wsB!.id, { installationUuid: uuidA, code: codeSteal })).ok === false);
  const codeB = randomBytes(16).toString("hex");
  VALID_CODES.set(codeB, uuidB);
  check("workspace B installs its own org", (await store.claimSentryInstallation(wsB!.id, { installationUuid: uuidB, code: codeB })).ok);

  // 3. credentialFor: fresh token as is; expiring token refreshed once under concurrency
  const resolvedA = await ws.resolveWorkspace({ authenticator: ws.SENTRY_WEBHOOK_AUTHENTICATOR, principalType: "service", principalId: `sentry:${uuidA}`, attributes: { sentry_app: "public", installation_uuid: uuidA } });
  check("resolveWorkspace: public Sentry App turn → the installing workspace", resolvedA.workspace.id === wsA!.id);
  const demoResolved = await ws.resolveWorkspace({ authenticator: ws.SENTRY_WEBHOOK_AUTHENTICATOR, principalType: "service", principalId: `sentry:${uuidA}`, attributes: {} });
  check("resolveWorkspace: demo-integration turn (no sentry_app attr) → demo", demoResolved.workspace.isDemo);
  const unknownResolved = await ws.resolveWorkspace({ authenticator: ws.SENTRY_WEBHOOK_AUTHENTICATOR, principalType: "service", principalId: "x", attributes: { sentry_app: "public", installation_uuid: randomUUID() } });
  check("resolveWorkspace: unknown installation → demo", unknownResolved.workspace.isDemo);

  const callsBefore = sentryCalls.length;
  check("credentialFor: fresh token returned as is", (await ws.credentialFor(resolvedA, ws.findConnection(resolvedA, "sentry"), "env-demo")) === "tok-1");
  check("credentialFor: no refresh while fresh", sentryCalls.length === callsBefore);

  await db
    .update(schema.connections)
    .set({ config: { ...configA, expiresAt: new Date(Date.now() - 60_000).toISOString() } })
    .where(eq(schema.connections.id, rowA!.id));
  const expired = await ws.resolveWorkspace({ authenticator: ws.SENTRY_WEBHOOK_AUTHENTICATOR, principalType: "service", principalId: `sentry:${uuidA}`, attributes: { sentry_app: "public", installation_uuid: uuidA } });
  const [t1, t2, t3] = await Promise.all([1, 2, 3].map(() => ws.credentialFor(expired, ws.findConnection(expired, "sentry"), undefined)));
  const refreshes = sentryCalls.filter((c) => c.path.endsWith(`/${uuidA}/authorizations/`) && c.body?.grant_type === "urn:sentry:params:oauth:grant-type:jwt-bearer");
  check("expired token: 3 concurrent callers → exactly 1 refresh (jwt-bearer)", refreshes.length === 1);
  check("expired token: all callers get the same new token", t1 === t2 && t2 === t3 && t1 !== "tok-1" && typeof t1 === "string" && t1.startsWith("tok-"));
  const [refreshed] = await db.select().from(schema.connections).where(eq(schema.connections.id, rowA!.id));
  const refreshedConfig = refreshed?.config as Record<string, unknown>;
  check("refresh written back: new ciphertext + future expiresAt", openConnectionSecret({ ...refreshed!, secretCiphertext: refreshed!.secretCiphertext! }) === t1 && Date.parse(String(refreshedConfig.expiresAt)) > Date.now() + 7 * 60 * 60 * 1000);

  // 4. Webhook channel
  check("unsigned → 401", (await post("issue", issueBody(uuidA, { id: "9001", shortId, title: "t" }), null)).status === 401);
  check("signed with an unknown secret → 401", (await post("issue", issueBody(uuidA, { id: "9001", shortId, title: "t" }), randomBytes(16).toString("hex"))).status === 401);

  const first = await post("issue", issueBody(uuidA, { id: "9001", shortId, title: "Checkout crash (test)" }), CLIENT_SECRET);
  const [incA] = await db.select().from(schema.incidents).where(eq(schema.incidents.sentryIssueId, shortId));
  check("public issue.created → 202 + triage started", first.status === 202 && first.sent.length === 1);
  check("incident claimed in the installing workspace", incA?.workspaceId === wsA!.id && incA.status === "investigating");
  const sent = first.sent[0]!;
  check("triage principal routes by installation (sentry_app=public, installation_uuid)", sent?.auth.authenticator === "sentry-webhook" && sent.auth.attributes.sentry_app === "public" && sent.auth.attributes.installation_uuid === uuidA);
  check("triage message names the issue", sent?.message.includes(shortId) && sent.message.includes("9001"));
  const fromSent = await ws.resolveWorkspace(sent!.auth);
  check("the started turn resolves to workspace A", fromSent.workspace.id === wsA!.id);

  const retry = await post("issue", issueBody(uuidA, { id: "9001", shortId, title: "Checkout crash (test)" }), CLIENT_SECRET);
  check("retry in the same workspace → already triaged, nothing started", retry.status === 200 && retry.text === "already triaged" && retry.sent.length === 0);
  const other = await post("issue", issueBody(uuidB, { id: "9002", shortId, title: "Same short id, other org" }), CLIENT_SECRET);
  check("same short id in workspace B → its own triage (dedupe is per workspace)", other.status === 202 && other.sent.length === 1 && other.text.includes(`${shortId}@ws${wsB!.id}`));
  check("workspace B's triage routes to B", (await ws.resolveWorkspace(other.sent[0]!.auth)).workspace.id === wsB!.id);
  const retryB = await post("issue", issueBody(uuidB, { id: "9002", shortId, title: "Same short id, other org" }), CLIENT_SECRET);
  check("workspace B retry → already triaged", retryB.text === "already triaged" && retryB.sent.length === 0);

  await db.update(schema.connections).set({ status: "error" }).where(eq(schema.connections.workspaceId, wsB!.id));
  const erroredB = await ws.resolveWorkspace(other.sent[0]!.auth);
  check("a failed Test (status error) doesn't cut the agent off: still routes + token", erroredB.workspace.id === wsB!.id && typeof (await ws.credentialFor(erroredB, ws.findConnection(erroredB, "sentry"), undefined)) === "string");
  await db.update(schema.connections).set({ status: "connected" }).where(eq(schema.connections.workspaceId, wsB!.id));

  const unknown = await post("issue", issueBody(randomUUID(), { id: "9003", shortId: `${shortId}-X`, title: "t" }), CLIENT_SECRET);
  check("unknown installation → 200, nothing started", unknown.status === 200 && unknown.sent.length === 0);
  const created = await post("installation", installationBody("created", uuidA), CLIENT_SECRET);
  check("installation.created → 200 (code is exchanged by the redirect callback)", created.status === 200 && created.sent.length === 0);

  const demo = await post("issue", issueBody(randomUUID(), { id: "9004", shortId: demoShortId, title: "Demo shop crash (test)" }), DEMO_SECRET);
  const [incDemo] = await db.select().from(schema.incidents).where(eq(schema.incidents.sentryIssueId, demoShortId));
  const demoWs = await ws.getDemoWorkspace();
  check("demo integration (SENTRY_WEBHOOK_SECRET) → 202, demo workspace, as before", demo.status === 202 && incDemo?.workspaceId === demoWs.id);
  check("demo triage principal has no attributes (→ demo)", JSON.stringify(demo.sent[0]?.auth.attributes) === "{}" && (await ws.resolveWorkspace(demo.sent[0]!.auth)).workspace.isDemo);

  const deleted = await post("installation", installationBody("deleted", uuidA), CLIENT_SECRET);
  const [gone] = await db.select().from(schema.connections).where(eq(schema.connections.id, rowA!.id));
  check("installation.deleted → connection disconnected, token dropped", deleted.status === 200 && gone?.status === "disconnected" && gone.secretCiphertext === null);
  const resolvedAfter = await ws.resolveWorkspace({ authenticator: ws.SENTRY_WEBHOOK_AUTHENTICATOR, principalType: "service", principalId: "x", attributes: { sentry_app: "public", installation_uuid: uuidA } });
  check("uninstalled installation no longer routes (→ demo)", resolvedAfter.workspace.isDemo);
  const wsAState = { workspace: wsA!, connections: await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, wsA!.id)) };
  check("findConnection skips a disconnected row", ws.findConnection(wsAState, "sentry") === undefined);
  const afterIssue = await post("issue", issueBody(uuidA, { id: "9005", shortId: `${shortId}-2`, title: "t" }), CLIENT_SECRET);
  check("issue for an uninstalled installation → 200, nothing started", afterIssue.status === 200 && afterIssue.sent.length === 0);

  // 5. Flag OFF: production behavior
  enable(false);
  check("flag off: client-secret-signed webhook → 401", (await post("issue", issueBody(uuidB, { id: "9006", shortId: `${shortId}-3`, title: "t" }), CLIENT_SECRET)).status === 401);
  check("flag off: unsigned → 401", (await post("issue", issueBody(uuidB, { id: "9006", shortId: `${shortId}-3`, title: "t" }), null)).status === 401);
  const demoOff = await post("issue", issueBody(randomUUID(), { id: "9007", shortId: `${demoShortId}-2`, title: "Demo (flag off)" }), DEMO_SECRET);
  check("flag off: demo webhook still triages", demoOff.status === 202);
  delete process.env.SENTRY_WEBHOOK_SECRET;
  check("flag off + no demo secret → 503 (unchanged)", (await post("issue", {}, null)).status === 503);
  const wsBRow = { workspace: wsB!, connections: await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, wsB!.id)) };
  check("flag off: credentialFor returns no token once it needs a refresh", await (async () => {
    const row = wsBRow.connections[0]!;
    await db.update(schema.connections).set({ config: { ...(row.config as object), expiresAt: new Date(0).toISOString() } }).where(eq(schema.connections.id, row.id));
    const [stale] = await db.select().from(schema.connections).where(eq(schema.connections.id, row.id));
    return (await ws.credentialFor({ ...wsBRow, connections: [stale!] }, stale, "env-demo")) === null;
  })());
} finally {
  await db.delete(schema.incidents).where(like(schema.incidents.sentryIssueId, `SAPPTEST-${RUN}-%`));
  await db.delete(schema.connections).where(inArray(schema.connections.workspaceId, workspaceIds));
  await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds));
  globalThis.fetch = realFetch;
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
