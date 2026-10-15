// Quick connect ("paste your keys"): GitHub personal access token + per-workspace GitHub and
// Sentry webhooks. GitHub's and Sentry's HTTP APIs are mocked for the pasted-token checks;
// webhooks are synthetic, correctly (or deliberately wrongly) signed payloads driven straight
// into the channel handlers. Writes to a NON-production Neon branch and removes its rows after.
//
//   npx tsx --env-file=.env.devconnect scripts/quick-connect-test.ts
//   # + live, read-only: the demo workspace's GitHub App token via Vercel Connect (needs VERCEL_OIDC_TOKEN)
//   npx tsx --env-file=.env.local scripts/quick-connect-test.ts        (.env.local pointing at dev-connect)
//
// No model calls, no eve dev (scripts/quick-connect-eve-test.ts drives the real agent). Tokens
// and secrets are random per run and never printed.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production" || !process.env.DATABASE_URL) {
  console.error("Refusing to run: point --env-file at a non-production Neon branch (NEON_BRANCH, DATABASE_URL).");
  process.exit(2);
}

process.env.CONNECTIONS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
delete process.env.CONNECTIONS_STORE; // the real Postgres store
const DEMO_SECRET = randomBytes(32).toString("hex");
process.env.SENTRY_WEBHOOK_SECRET = DEMO_SECRET;
const DEMO_SENTRY_TOKEN = `demo-env-${randomBytes(8).toString("hex")}`;
process.env.SENTRY_AUTH_TOKEN = DEMO_SENTRY_TOKEN; // must never be used for a workspace's lookups
delete process.env.ROARY_USER_MSGS_PER_HOUR;
delete process.env.ROARY_USER_MSGS_PER_DAY;

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

// ---- mocked GitHub (only for this run's test tokens) and Sentry ------------------------------
const RUN = randomBytes(3).toString("hex");
const pat = () => `github_pat_TEST${RUN}_${randomBytes(30).toString("hex")}`;
const LOGIN = `roary-bot-${RUN}`;
const IN_60D = new Date(Date.now() + 60 * 86_400_000);
const fmtExpiry = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
const githubRepos = new Map<string, { full_name: string; push: boolean }>([
  [`acme-${RUN}/web`, { full_name: `Acme-${RUN}/Web`, push: true }],
  [`acme-${RUN}/api`, { full_name: `acme-${RUN}/api`, push: true }],
  [`acme-${RUN}/docs`, { full_name: `acme-${RUN}/docs`, push: false }],
]);
const revoked = new Set<string>();
const tokenExpiry = new Map<string, string | null>();
const sentryCalls: { path: string; auth?: string }[] = [];
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (url.hostname === "api.github.com" && auth.startsWith(`Bearer github_pat_TEST${RUN}`)) {
    const token = auth.slice("Bearer ".length);
    if (revoked.has(token)) return json(401, { message: "Bad credentials" });
    if (url.pathname === "/user") {
      const expiry = tokenExpiry.has(token) ? tokenExpiry.get(token) : fmtExpiry(IN_60D);
      return json(200, { login: LOGIN }, expiry ? { "github-authentication-token-expiration": expiry } : {});
    }
    const repo = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/)?.[1]?.toLowerCase();
    const known = repo ? githubRepos.get(repo) : undefined;
    if (known) return json(200, { full_name: known.full_name, permissions: { admin: false, push: known.push, pull: true } });
    return json(404, { message: "Not Found" });
  }
  if (url.hostname === "sentry.io") {
    sentryCalls.push({ path: url.pathname, auth });
    if (/^\/api\/0\/projects\/[^/]+\/[^/]+\/$/.test(url.pathname)) return json(200, { slug: "web", name: "Web" });
    const issue = url.pathname.match(/^\/api\/0\/issues\/(\d+)\/$/);
    if (issue) return json(200, { id: issue[1], shortId: `QCTEST-${RUN}-ALERT` });
    return json(404, { detail: "not mocked" });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ---- modules under test ------------------------------------------------------------------------
const { db, schema } = await import("../agent/lib/db");
const crypto = await import("../agent/lib/crypto");
const ws = await import("../agent/lib/workspace");
const qc = await import("../agent/lib/quick-connect");
const { GITHUB_PAT_WEBHOOK_AUTHENTICATOR } = await import("../agent/lib/quick-connect-config");
const { githubToken } = await import("../agent/lib/github-token");
const { workspaceContext } = await import("../agent/lib/workspace-context");
const { ROARY_MARKER } = await import("../agent/lib/github-pat-webhook");
const validate = await import("../apps/web/lib/connections/validate");
const service = await import("../apps/web/lib/connections/service");
const { toPublic } = await import("../apps/web/lib/connections/types");
const { getConnectionStore } = await import("../apps/web/lib/connections/store");

type Route = { method: string; path: string; handler: (req: Request, args: any) => Promise<Response> };
const routeOf = async (file: string, path: string) =>
  ((await import(file)).default as { routes: Route[] }).routes.find((r) => r.method === "POST" && r.path === path)!;
const githubRoute = await routeOf("../agent/channels/github-webhook", "/github/webhook/:publicId");
const sentryRoute = await routeOf("../agent/channels/sentry-workspace-webhook", "/sentry/webhook/:publicId");
const demoSentryRoute = await routeOf("../agent/channels/sentry-webhook", "/sentry/webhook");

type Sent = { address: string; message: string; auth: any };
async function drive(route: Route, path: string, params: Record<string, string>, headers: Record<string, string>, raw: string) {
  const sent: Sent[] = [];
  const pending: Promise<unknown>[] = [];
  const response = await route.handler(new Request(`https://roary.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }), {
    params,
    from: (address: string) => ({ send: async (message: string, options: { auth: unknown }) => void sent.push({ address, message, auth: options.auth }) }),
    waitUntil: (task: Promise<unknown>) => pending.push(task),
  });
  await Promise.all(pending);
  return { status: response.status, body: await response.text(), sent };
}
const hubSig = (raw: string, secret: string) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
function postGithub(publicId: string, event: string, payload: object, secret: string | null, delivery = randomUUID()) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "x-github-event": event, "x-github-delivery": delivery };
  if (secret) headers["x-hub-signature-256"] = hubSig(raw, secret);
  return drive(githubRoute, `/github/webhook/${publicId}`, { publicId }, headers, raw);
}
function postSentry(publicId: string, resource: string, payload: object, secret: string | null, requestId = randomUUID()) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "sentry-hook-resource": resource, "request-id": requestId };
  if (secret) headers["sentry-hook-signature"] = createHmac("sha256", secret).update(raw).digest("hex");
  return drive(sentryRoute, `/sentry/webhook/${publicId}`, { publicId }, headers, raw);
}
const comment = (repo: string, body: string, n = 7) => ({
  action: "created",
  repository: { full_name: repo },
  sender: { login: "teammate", type: "User" },
  issue: { number: n, title: "Checkout is slow", body: "" },
  comment: { body, html_url: `https://github.com/${repo}/issues/${n}#c1`, user: { login: "teammate", type: "User" } },
});
const merged = (repo: string, labels: string[], n = 12) => ({
  action: "closed",
  repository: { full_name: repo },
  sender: { login: "teammate", type: "User" },
  pull_request: { number: n, title: "New checkout", merged: true, labels: labels.map((name) => ({ name })) },
});
const sentryIssue = (id: string, shortId: string) => ({
  action: "created",
  installation: { uuid: randomUUID() },
  data: { issue: { id, shortId, title: "TypeError in checkout", project: { slug: "web" } } },
});

// ---- fixtures ------------------------------------------------------------------------------------
const tag = `qc-test-${RUN}`;
const mk = async (suffix: string) => (await db.insert(schema.workspaces).values({ name: `${tag}-${suffix}`, ownerUserId: `${tag}-${suffix}` }).returning())[0]!;
const wsA = await mk("a"); // GitHub PAT + webhook
const wsB = await mk("b"); // GitHub PAT + webhook (other repos)
const wsC = await mk("c"); // GitHub App row (fake installation), no PAT
const wsD = await mk("d"); // Sentry internal integration
const wsE = await mk("e"); // Sentry internal integration (other secret)
const wsF = await mk("f"); // nothing connected
const workspaceIds = [wsA.id, wsB.id, wsC.id, wsD.id, wsE.id, wsF.id];
const REPO_A = `acme-${RUN}/web`;
const REPO_B = `acme-${RUN}/api`;
const principalFor = (publicId: string) => ({
  authenticator: GITHUB_PAT_WEBHOOK_AUTHENTICATOR,
  principalType: "service",
  principalId: "github:teammate",
  attributes: { workspace_public_id: publicId },
});

try {
  // 1. Pure helpers
  check("public ids are 32 hex chars and differ per workspace", /^[0-9a-f]{32}$/.test(wsA.publicId) && wsA.publicId !== wsB.publicId);
  check("expiry header: UTC", validate.parseTokenExpiration("2026-11-13 08:00:00 UTC") === "2026-11-13T08:00:00.000Z");
  check("expiry header: offset", validate.parseTokenExpiration("2026-11-13 08:00:00 -0800") === "2026-11-13T16:00:00.000Z");
  check("expiry header: missing / garbage → null", validate.parseTokenExpiration(null) === null && validate.parseTokenExpiration("soon") === null);
  check("repo list: lines, commas, URLs, dedupe", JSON.stringify(validate.parseRepoList("a/b, https://github.com/c/d.git\nA/B")) === JSON.stringify(["a/b", "c/d"]));
  check("repo list: traversal and junk refused", validate.parseRepoList("a/..") === null && validate.parseRepoList("../x") === null && validate.parseRepoList("nope") === null);
  const raw = '{"zen":"hi"}';
  check("X-Hub-Signature-256: valid", qc.verifyGithubSignature(raw, hubSig(raw, "s3cret"), "s3cret"));
  check("X-Hub-Signature-256: wrong secret / missing / sha1", !qc.verifyGithubSignature(raw, hubSig(raw, "other"), "s3cret") && !qc.verifyGithubSignature(raw, null, "s3cret") && !qc.verifyGithubSignature(raw, "sha1=abc", "s3cret"));
  check("X-Hub-Signature-256: tampered body", !qc.verifyGithubSignature('{"zen":"ho"}', hubSig(raw, "s3cret"), "s3cret"));

  // 2. PAT validation (GitHub mocked)
  const tokA = pat();
  const okCheck = await validate.validateGithubPat(tokA, [REPO_A, REPO_B]);
  check("PAT: valid → login, canonical repo names, expiry from the header", okCheck.ok && okCheck.detail.login === LOGIN && okCheck.detail.repos[0] === `Acme-${RUN}/Web` && okCheck.detail.expiresAt === new Date(IN_60D.toISOString().slice(0, 19) + "Z").toISOString());
  const bad = pat();
  revoked.add(bad);
  check("PAT: revoked/wrong → unauthorized", (await validate.validateGithubPat(bad, [REPO_A])).ok === false && ((await validate.validateGithubPat(bad, [REPO_A])) as any).code === "unauthorized");
  check("PAT: repo it can't see → repo_not_found", ((await validate.validateGithubPat(pat(), [REPO_A, `acme-${RUN}/secret`])) as any).code === "repo_not_found");
  check("PAT: read-only repo → read_only", ((await validate.validateGithubPat(pat(), [`acme-${RUN}/docs`])) as any).code === "read_only");
  const expired = pat();
  tokenExpiry.set(expired, "2020-01-01 00:00:00 UTC");
  check("PAT: expired → expired", ((await validate.validateGithubPat(expired, [REPO_A])) as any).code === "expired");
  const noExpiry = pat();
  tokenExpiry.set(noExpiry, null);
  const noExp = await validate.validateGithubPat(noExpiry, [REPO_A]);
  check("PAT: no expiry header → expiresAt null", noExp.ok && noExp.detail.expiresAt === null);
  check("PAT: malformed token / no repos / >20 repos → bad_input", ((await validate.validateGithubPat("nope", [REPO_A])) as any).code === "bad_input" && ((await validate.validateGithubPat(pat(), "")) as any).code === "bad_input" && ((await validate.validateGithubPat(pat(), Array.from({ length: 21 }, (_, i) => `o/r${i}`))) as any).code === "bad_input");

  // 3. Save → encrypted row, webhook secret shown once
  const savedA = await service.saveGithubPat(wsA.id, { token: tokA, repos: `${REPO_A}` });
  const secretA = savedA.ok ? savedA.webhookSecret : undefined;
  check("save: ok and a 64-hex webhook secret returned once", savedA.ok && /^[0-9a-f]{64}$/.test(secretA ?? ""));
  const [rowA] = await db.select().from(schema.connections).where(and(eq(schema.connections.workspaceId, wsA.id), eq(schema.connections.provider, "github")));
  const cfgA = rowA!.config as Record<string, unknown>;
  check("save: config {mode pat, repos, login, expiresAt}, no connector", cfgA.mode === "pat" && (cfgA.repos as string[])[0] === `Acme-${RUN}/Web` && cfgA.login === LOGIN && typeof cfgA.expiresAt === "string" && rowA!.connectorRef === null);
  check("save: PAT and webhook secret stored encrypted, not in config", rowA!.secretCiphertext!.startsWith("v1.") && !rowA!.secretCiphertext!.includes(tokA) && rowA!.webhookSecretCiphertext!.startsWith("v1.") && !JSON.stringify(cfgA).includes(tokA));
  check("save: webhook secret decrypts with its own AAD", crypto.openWebhookSecret({ ...rowA!, webhookSecretCiphertext: rowA!.webhookSecretCiphertext! }) === secretA);
  check("save: the webhook ciphertext can't be read as the API token (different AAD)", (() => {
    try {
      crypto.openConnectionSecret({ ...rowA!, secretCiphertext: rowA!.webhookSecretCiphertext! });
      return false;
    } catch {
      return true;
    }
  })());
  const pub = JSON.stringify(savedA.ok ? savedA.connection : {});
  check("save: the public view has no ciphertext, token or secret", !pub.includes("Ciphertext\"") && !pub.includes(tokA) && !pub.includes(secretA!) && pub.includes('"hasWebhookSecret":true'));
  const tokA2 = pat();
  const again = await service.saveGithubPat(wsA.id, { token: tokA2, repos: [REPO_A] });
  const [rowA2] = await db.select().from(schema.connections).where(eq(schema.connections.id, rowA!.id));
  check("replace token: no new secret, the old one still works", again.ok && again.webhookSecret === undefined && crypto.openWebhookSecret({ ...rowA2!, webhookSecretCiphertext: rowA2!.webhookSecretCiphertext! }) === secretA);
  check("replace token: the new PAT is the credential", crypto.openConnectionSecret({ ...rowA2!, secretCiphertext: rowA2!.secretCiphertext! }) === tokA2);
  check("Test button: re-validates the stored PAT", (await service.testConnection(wsA.id, "github")).ok);
  const tokB = pat();
  const savedB = await service.saveGithubPat(wsB.id, { token: tokB, repos: [REPO_B] });
  const secretB = savedB.ok ? savedB.webhookSecret! : "";
  check("workspace B gets its own, different secret", savedB.ok && secretB !== secretA);
  const store = await getConnectionStore();
  await store.upsert({ workspaceId: wsC.id, provider: "github", status: "connected", config: { installationId: `9${Date.now()}`.slice(0, 12), repos: [REPO_A] }, secretCiphertext: null, connectorRef: "github/roary" });

  // 4. Credential isolation
  const resolvedA = await ws.resolveWorkspace(principalFor(wsA.publicId));
  check("resolveWorkspace: quick-connect GitHub principal → its workspace", resolvedA.workspace.id === wsA.id);
  check("resolveWorkspace: unknown public id throws (never the demo)", await ws.resolveWorkspace(principalFor("0".repeat(32))).then(() => false, () => true));
  check("resolveWorkspace: missing public id throws", await ws.resolveWorkspace({ ...principalFor(""), attributes: {} }).then(() => false, () => true));
  check("GitHub tools: PAT workspace gets its PAT for a listed repo (any case)", (await githubToken(principalFor(wsA.publicId), { toolName: "getRepository", input: {}, owner: `acme-${RUN}`, repo: "WEB" })) === tokA2);
  check("GitHub tools: PAT workspace refused for a repo it didn't list", await githubToken(principalFor(wsA.publicId), { toolName: "getRepository", input: {}, owner: `acme-${RUN}`, repo: "api" }).then(() => false, () => true));
  check("GitHub tools: workspace B gets B's PAT, never A's", (await githubToken(principalFor(wsB.publicId), { toolName: "getRepository", input: {}, owner: `acme-${RUN}`, repo: "api" })) === tokB);
  const userF = { authenticator: ws.NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: `${tag}-f` };
  check("GitHub tools: a workspace with no GitHub is refused (no demo fallback)", await githubToken(userF, { toolName: "getRepository", input: {}, owner: "scarranca", repo: "roary-demo-shop" }).then(() => false, (e) => /no GitHub connection/.test(String(e))));
  const userC = { authenticator: ws.NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: `${tag}-c` };
  const appResult = await githubToken(userC, { toolName: "getRepository", input: {}, owner: `acme-${RUN}`, repo: "web" }).then((t) => t, () => "rejected");
  check("GitHub tools: an App-mode workspace goes to Connect, never a PAT", appResult !== tokA2 && appResult !== tokB);
  check("GitHub tools: no principal → refused", await githubToken(null, { toolName: "getRepository", input: {} }).then(() => false, () => true));
  const demo = await ws.getDemoWorkspace();
  check("credentialFor: a PAT row never serves the demo workspace", (await ws.credentialFor({ workspace: demo, connections: [rowA2!] }, rowA2!, "env")) === null);
  check("credentialFor: a PAT row in error status isn't used", (await ws.credentialFor(resolvedA, { ...rowA2!, status: "error" }, undefined)) === null);
  const ctxLine = await workspaceContext(principalFor(wsA.publicId));
  check("[Workspace] line names @login, never the token", ctxLine.includes(`@${LOGIN}`) && !ctxLine.includes(tokA2));
  if (process.env.VERCEL_OIDC_TOKEN) {
    const guest = { authenticator: "roary-guest", principalType: "anonymous", principalId: "qc-test-guest" };
    const demoToken = await githubToken(guest, { toolName: "getRepository", input: {}, owner: "scarranca", repo: "roary-demo-shop" }).catch(() => "");
    const live = demoToken ? await realFetch("https://api.github.com/repos/scarranca/roary-demo-shop", { headers: { authorization: `Bearer ${demoToken}`, accept: "application/vnd.github+json" } }) : undefined;
    check("live (read-only): the demo workspace still gets the GitHub App token via Connect", !!live?.ok && ![tokA2, tokB].includes(demoToken));
  } else {
    console.log("SKIP  live demo Connect token (no VERCEL_OIDC_TOKEN)");
  }

  // 5. GitHub webhook route
  check("route: unknown public id → 404", (await postGithub("f".repeat(32), "ping", {}, secretA!)).status === 404);
  check("route: malformed id → 404", (await postGithub("../etc", "ping", {}, secretA!)).status === 404);
  check("route: workspace without GitHub quick connect → 404", (await postGithub(wsF.publicId, "ping", {}, secretA!)).status === 404 && (await postGithub(wsC.publicId, "ping", {}, secretA!)).status === 404);
  check("route: unsigned → 401", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary hi"), null)).status === 401);
  check("route: wrong secret → 401", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary hi"), "nope")).status === 401);
  const crossAB = await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary hi"), secretB);
  check("isolation: B's secret can't trigger A", crossAB.status === 401 && crossAB.sent.length === 0);
  const crossBA = await postGithub(wsB.publicId, "issue_comment", comment(REPO_B, "@roary hi"), secretA!);
  check("isolation: A's secret can't trigger B", crossBA.status === 401 && crossBA.sent.length === 0);
  const ping = await postGithub(wsA.publicId, "ping", { zen: "Keep it logically awesome." }, secretA!);
  check("ping → 200, nothing starts", ping.status === 200 && ping.sent.length === 0);
  const delivery = randomUUID();
  const mention = await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary why is checkout slow?"), secretA!, delivery);
  const sentAuth = mention.sent[0]?.auth;
  check("@roary comment → 202, one session in A", mention.status === 202 && mention.sent.length === 1 && mention.sent[0]!.address.includes(wsA.publicId));
  check("…as the quick-connect principal that resolves to A", sentAuth?.authenticator === GITHUB_PAT_WEBHOOK_AUTHENTICATOR && (await ws.resolveWorkspace(sentAuth)).workspace.id === wsA.id);
  check("…telling Roary to reply with github__addIssueComment and the marker", /github__addIssueComment/.test(mention.sent[0]!.message) && mention.sent[0]!.message.includes(ROARY_MARKER) && mention.sent[0]!.message.includes("[Workspace]"));
  const replay = await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary why is checkout slow?"), secretA!, delivery);
  check("replay (same X-GitHub-Delivery) → 200 duplicate, nothing starts", replay.status === 200 && replay.sent.length === 0 && replay.body.includes("duplicate"));
  check("no mention → ignored", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "looks good"), secretA!)).sent.length === 0);
  check("@roaryx / email-like → ignored", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "ping @roaryx and me@roary.dev"), secretA!)).sent.length === 0);
  check("Roary's own marked reply → ignored (no loop)", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, `Thanks @roary!\n${ROARY_MARKER}`), secretA!)).sent.length === 0);
  check("repo not connected to A → ignored", (await postGithub(wsA.publicId, "issue_comment", comment(REPO_B, "@roary hi"), secretA!)).sent.length === 0);
  const launch = await postGithub(wsA.publicId, "pull_request", merged(REPO_A, ["Launch"]), secretA!);
  check("merged PR labeled launch → launch-video session in A", launch.status === 202 && /launch-video skill/.test(launch.sent[0]?.message ?? "") && (await ws.resolveWorkspace(launch.sent[0]!.auth)).workspace.id === wsA.id);
  check("merged PR without the label → ignored", (await postGithub(wsA.publicId, "pull_request", merged(REPO_A, ["bug"]), secretA!)).sent.length === 0);
  const opened = await postGithub(wsA.publicId, "issues", { action: "opened", repository: { full_name: REPO_A }, sender: { login: "teammate", type: "User" }, issue: { number: 9, title: "Bug", body: "@roary can you look?" } }, secretA!);
  check("new issue mentioning @roary → session in A", opened.status === 202 && opened.sent.length === 1);

  // rotation
  const rotated = await service.rotateGithubWebhookSecret(wsA.id);
  check("rotate: new secret works, old one is refused", rotated.ok && (await postGithub(wsA.publicId, "ping", {}, rotated.webhookSecret)).status === 200 && (await postGithub(wsA.publicId, "ping", {}, secretA!)).status === 401);
  const secretA2 = rotated.ok ? rotated.webhookSecret : "";

  // 6. Limits per workspace (#56) for webhook-started sessions
  const [hourRow] = await db.select().from(schema.usageCounters).where(and(eq(schema.usageCounters.scopeKey, `ws:${wsA.id}`), eq(schema.usageCounters.period, "hour")));
  check("each started webhook session counted against ws:A (3 so far)", hourRow?.messages === 3);
  process.env.ROARY_USER_MSGS_PER_HOUR = "3";
  const limitedDelivery = randomUUID();
  const limited = await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary again", 8), secretA2, limitedDelivery);
  check("over the hourly cap → 200 rate_limited, nothing starts", limited.status === 200 && limited.sent.length === 0 && limited.body.includes("rate_limited"));
  const otherWs = await postGithub(wsB.publicId, "issue_comment", comment(REPO_B, "@roary hi"), secretB);
  check("…while workspace B is unaffected", otherWs.status === 202 && otherWs.sent.length === 1);
  process.env.ROARY_USER_MSGS_PER_HOUR = "100";
  const redeliver = await postGithub(wsA.publicId, "issue_comment", comment(REPO_A, "@roary again", 8), secretA2, limitedDelivery);
  check("a refused delivery isn't burned: redelivering it later starts the session", redeliver.status === 202 && redeliver.sent.length === 1);
  delete process.env.ROARY_USER_MSGS_PER_HOUR;

  // 7. Sentry per-workspace webhook
  const clientD = randomBytes(32).toString("hex");
  const clientE = randomBytes(32).toString("hex");
  const tokD = `sntrys_D${randomBytes(16).toString("hex")}`;
  const tokE = `sntrys_E${randomBytes(16).toString("hex")}`;
  const savedD = await service.saveSentry(wsD.id, { token: tokD, org: "acme", project: "web", clientSecret: clientD });
  await service.saveSentry(wsE.id, { token: tokE, org: "other", project: "web", clientSecret: clientE });
  const [rowD] = await db.select().from(schema.connections).where(and(eq(schema.connections.workspaceId, wsD.id), eq(schema.connections.provider, "sentry")));
  check("sentry save: config source internal, token + client secret encrypted", savedD.ok && (rowD!.config as any).source === "internal" && crypto.openWebhookSecret({ ...rowD!, webhookSecretCiphertext: rowD!.webhookSecretCiphertext! }) === clientD && !JSON.stringify(savedD).includes(clientD));
  check("sentry route: unknown id → 404; PAT-only workspace → 404", (await postSentry("a".repeat(32), "issue", sentryIssue("1", "X-1"), clientD)).status === 404 && (await postSentry(wsA.publicId, "issue", sentryIssue("1", "X-1"), clientD)).status === 404);
  check("sentry route: unsigned → 401", (await postSentry(wsD.publicId, "issue", sentryIssue("1", "X-1"), null)).status === 401);
  check("sentry route: the demo secret can't trigger a workspace", (await postSentry(wsD.publicId, "issue", sentryIssue("1", "X-1"), DEMO_SECRET)).status === 401);
  const crossDE = await postSentry(wsD.publicId, "issue", sentryIssue("1", "X-1"), clientE);
  check("isolation: E's client secret can't trigger D", crossDE.status === 401 && crossDE.sent.length === 0);
  const shortD = `QCTEST-${RUN}-1`;
  const reqId = randomUUID();
  const triage = await postSentry(wsD.publicId, "issue", sentryIssue("71001", shortD), clientD, reqId);
  const [incD] = await db.select().from(schema.incidents).where(eq(schema.incidents.sentryIssueId, shortD));
  check("signed issue.created → 202, triage starts in D, incident claimed in D", triage.status === 202 && triage.sent.length === 1 && incD?.workspaceId === wsD.id);
  check("…as {sentry_app: internal, workspace_public_id} resolving to D", triage.sent[0]?.auth.attributes.sentry_app === "internal" && (await ws.resolveWorkspace(triage.sent[0]!.auth)).workspace.id === wsD.id);
  check("replay (same request-id) → duplicate", (await postSentry(wsD.publicId, "issue", sentryIssue("71001", shortD), clientD, reqId)).body.includes("duplicate"));
  check("retry (new request-id) → already triaged, nothing starts", (await postSentry(wsD.publicId, "issue", sentryIssue("71001", shortD), clientD)).sent.length === 0);
  const sameShortE = await postSentry(wsE.publicId, "issue", sentryIssue("71002", shortD), clientE);
  check("same short id in another workspace → its own scoped incident", sameShortE.status === 202 && sameShortE.body.includes(`${shortD}@ws${wsE.id}`));
  check("installation webhook → 200, nothing starts", (await postSentry(wsD.publicId, "installation", { action: "created" }, clientD)).sent.length === 0);
  sentryCalls.length = 0;
  const alert = await postSentry(wsD.publicId, "event_alert", { action: "triggered", data: { event: { issue_id: "71003", title: "Alert", project_slug: "web" } } }, clientD);
  check("event_alert → short id looked up with D's own token, never SENTRY_AUTH_TOKEN", alert.status === 202 && sentryCalls.some((c) => c.auth === `Bearer ${tokD}`) && !sentryCalls.some((c) => c.auth.includes(DEMO_SENTRY_TOKEN)));
  process.env.ROARY_USER_MSGS_PER_HOUR = "1";
  const limitedSentry = await postSentry(wsD.publicId, "issue", sentryIssue("71004", `QCTEST-${RUN}-4`), clientD);
  check("sentry: limits apply per workspace (200 rate_limited)", limitedSentry.status === 200 && limitedSentry.sent.length === 0 && limitedSentry.body.includes("rate_limited"));
  delete process.env.ROARY_USER_MSGS_PER_HOUR;

  // 8. The existing demo webhook is untouched
  const demoRaw = JSON.stringify({ action: "created", data: { issue: { id: "1" } } });
  const demoUnsigned = await drive(demoSentryRoute, "/sentry/webhook", {}, { "sentry-hook-resource": "issue" }, demoRaw);
  check("demo /sentry/webhook: unsigned → 401", demoUnsigned.status === 401);
  const clientDSigned = await drive(demoSentryRoute, "/sentry/webhook", {}, { "sentry-hook-resource": "issue", "sentry-hook-signature": createHmac("sha256", clientD).update(demoRaw).digest("hex") }, demoRaw);
  check("demo /sentry/webhook: a workspace's client secret is refused there", clientDSigned.status === 401);
  void toPublic;
} finally {
  await db.delete(schema.incidents).where(like(schema.incidents.sentryIssueId, `QCTEST-${RUN}-%`));
  await db.delete(schema.webhookDeliveries).where(inArray(schema.webhookDeliveries.workspaceId, workspaceIds));
  await db.delete(schema.usageCounters).where(inArray(schema.usageCounters.scopeKey, workspaceIds.map((id) => `ws:${id}`)));
  await db.delete(schema.connections).where(inArray(schema.connections.workspaceId, workspaceIds));
  await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds));
  globalThis.fetch = realFetch;
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
