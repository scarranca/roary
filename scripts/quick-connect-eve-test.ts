// Quick connect against the REAL agent (`eve dev`): signed per-workspace webhooks start sessions in
// the right workspace, are counted against its limits, record its spend, and the GitHub tools use
// that workspace's personal access token, never the demo's GitHub App. Model calls happen.
//
//   pkill -f "eve dev"; npx eve dev --no-ui &          # with .env.local pointing at a NON-production branch
//   npx tsx --env-file=.env.local scripts/quick-connect-eve-test.ts
//
// The PAT is fake on purpose and the issue number doesn't exist, so nothing is ever posted to
// GitHub: a GitHub 401 ("Bad credentials") on the demo repo — which the App token CAN read — proves
// the PAT was used. Secrets are random per run and never printed. Rows are removed after.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, like, or } from "drizzle-orm";

if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production" || !process.env.DATABASE_URL || !process.env.CONNECTIONS_ENCRYPTION_KEY) {
  console.error("Refusing to run: needs a non-production NEON_BRANCH, DATABASE_URL and the same CONNECTIONS_ENCRYPTION_KEY as eve dev.");
  process.exit(2);
}
const EVE_URL = process.env.EVE_URL ?? "http://127.0.0.1:2000";
const DEMO_REPO = "scarranca/roary-demo-shop";

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs: number): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(2_000);
  }
  return undefined;
}

const { db, schema } = await import("../agent/lib/db");
const { sealConnectionSecret, sealWebhookSecret } = await import("../agent/lib/crypto");

const RUN = randomBytes(3).toString("hex");
const tag = `qc-eve-${RUN}`;
const SENDER = `qc-eve-sender-${RUN}`;
const [wsP] = await db.insert(schema.workspaces).values({ name: `${tag}-pat`, ownerUserId: `${tag}-pat` }).returning();
const [wsS] = await db.insert(schema.workspaces).values({ name: `${tag}-sentry`, ownerUserId: `${tag}-sentry` }).returning();
const workspaceIds = [wsP!.id, wsS!.id];
const fakePat = `github_pat_QCEVE${RUN}_${randomBytes(30).toString("hex")}`;
const ghSecret = randomBytes(32).toString("hex");
const sentrySecret = randomBytes(32).toString("hex");
await db.insert(schema.connections).values([
  {
    workspaceId: wsP!.id,
    provider: "github",
    status: "connected",
    config: { mode: "pat", repos: [DEMO_REPO], login: SENDER, expiresAt: null },
    secretCiphertext: sealConnectionSecret(wsP!.id, "github", fakePat),
    webhookSecretCiphertext: sealWebhookSecret(wsP!.id, "github", ghSecret),
  },
  {
    workspaceId: wsS!.id,
    provider: "sentry",
    status: "connected",
    config: { org: `qc-eve-${RUN}`, project: "web", source: "internal" },
    secretCiphertext: sealConnectionSecret(wsS!.id, "sentry", `sntrys_fake_${randomBytes(12).toString("hex")}`),
    webhookSecretCiphertext: sealWebhookSecret(wsS!.id, "sentry", sentrySecret),
  },
]);

async function post(path: string, headers: Record<string, string>, body: object) {
  const res = await fetch(`${EVE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}
const github = (publicId: string, event: string, body: object, secret: string | null) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "x-github-event": event, "x-github-delivery": randomUUID() };
  if (secret) headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return post(`/github/webhook/${publicId}`, headers, body);
};
const sentry = (publicId: string, body: object, secret: string | null) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "sentry-hook-resource": "issue", "request-id": randomUUID() };
  if (secret) headers["sentry-hook-signature"] = createHmac("sha256", secret).update(raw).digest("hex");
  return post(`/sentry/webhook/${publicId}`, headers, body);
};
const sessionOf = (ownerKey: string) =>
  poll(async () => (await db.select().from(schema.chatSessions).where(eq(schema.chatSessions.ownerKey, ownerKey)).limit(1))[0], 120_000);

/**
 * The session's events. The stream route is owner-only (the webhook principal), so read eve dev's
 * local workflow store instead (.eve/.workflow-data/streams/chunks/strm_<run>_user/*.bin, each
 * holding base64 JSON events); fall back to the HTTP stream as the Vercel OIDC caller.
 */
async function events(sessionId: string): Promise<any[] | null> {
  const dir = join(process.cwd(), ".eve/.workflow-data/streams/chunks", `strm_${sessionId.replace(/^wrun_/, "")}_user`);
  if (existsSync(dir)) {
    const out: any[] = [];
    for (const file of readdirSync(dir).sort()) {
      for (const m of readFileSync(join(dir, file)).toString("latin1").matchAll(/"([A-Za-z0-9+/=]{40,})"/g)) {
        try {
          out.push(JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")));
        } catch {}
      }
    }
    return out;
  }
  if (!process.env.VERCEL_OIDC_TOKEN) return null;
  const res = await fetch(`${EVE_URL}/eve/v1/session/${sessionId}/stream?follow=false`, { headers: { authorization: `Bearer ${process.env.VERCEL_OIDC_TOKEN}` } });
  if (!res.ok) return null;
  return (await res.text())
    .split("\n")
    .map((l) => l.trim().replace(/^data:\s*/, ""))
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const sessionIds: string[] = [];
try {
  const health = await fetch(`${EVE_URL}/eve/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`eve dev isn't answering at ${EVE_URL}`);

  // Routing and verification over real HTTP
  check("unknown public id → 404", (await github("0".repeat(32), "ping", {}, ghSecret)).status === 404);
  check("unsigned → 401", (await github(wsP!.publicId, "ping", {}, null)).status === 401);
  check("the GitHub secret can't sign Sentry deliveries for another workspace", (await sentry(wsS!.publicId, { action: "created" }, ghSecret)).status === 401);
  check("ping → 200", (await github(wsP!.publicId, "ping", { zen: "hi" }, ghSecret)).status === 200);

  // 1. @roary mention → session in the PAT workspace, GitHub tools use the PAT
  const mention = await github(
    wsP!.publicId,
    "issue_comment",
    {
      action: "created",
      repository: { full_name: DEMO_REPO },
      sender: { login: SENDER, type: "User" },
      issue: { number: 999_999, title: "Quick connect test", body: "" },
      comment: {
        body: `@roary quick test: call github__getRepository for owner scarranca, repo roary-demo-shop, and report its default branch or the exact error. Don't post any comment.`,
        user: { login: SENDER, type: "User" },
      },
    },
    ghSecret,
  );
  check("signed @roary comment → 202", mention.status === 202, mention.text);
  const ghSession = await sessionOf(`github-pat-webhook:github:${SENDER}`);
  if (ghSession) sessionIds.push(ghSession.sessionId);
  check("the session started and is owned in the PAT workspace (turn.started → chat_sessions)", ghSession?.workspaceId === wsP!.id, JSON.stringify(ghSession ?? null));
  const [msgs] = await db.select().from(schema.usageCounters).where(and(eq(schema.usageCounters.scopeKey, `ws:${wsP!.id}`), eq(schema.usageCounters.period, "hour")));
  check("the webhook message counted against that workspace's limits", msgs?.messages === 1);
  const spend = await poll(
    async () => (await db.select().from(schema.usageCounters).where(and(eq(schema.usageCounters.scopeKey, `ws:${wsP!.id}`), eq(schema.usageCounters.period, "day"))))[0]?.inputTokens,
    120_000,
  );
  check("model usage recorded on that workspace (step.completed)", (spend ?? 0) > 0);
  if (ghSession) {
    const toolResult = await poll(async () => {
      const evs = await events(ghSession.sessionId);
      if (evs === null) return "unreadable";
      const results = evs.filter((e) => e.type === "action.result").map((e) => JSON.stringify(e.data));
      return results.find((r) => /defaultBranch|Bad credentials|401|unauthori/i.test(r));
    }, 150_000);
    if (toolResult === "unreadable") console.log("SKIP  tool result (session stream not readable here)");
    else {
      check("github tool used the workspace's PAT: GitHub 401 on a repo the App token can read", !!toolResult && /401|Bad credentials|unauthori/i.test(toolResult) && !/"defaultBranch"/.test(toolResult), toolResult?.slice(0, 200));
      check("the PAT never appears in the session stream", !(JSON.stringify((await events(ghSession.sessionId)) ?? []).includes(fakePat)));
    }
  }

  // 2. Sentry internal integration → triage in that workspace
  const shortId = `QCEVE-${RUN}-1`;
  const triage = await sentry(
    wsS!.publicId,
    { action: "created", data: { issue: { id: String(Date.now()).slice(-9), shortId, title: "Quick connect test error (synthetic)", project: { slug: "web" } } } },
    sentrySecret,
  );
  check("signed Sentry issue → 202", triage.status === 202, triage.text);
  const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.sentryIssueId, shortId));
  check("incident claimed in that workspace", incident?.workspaceId === wsS!.id);
  const sSession = await sessionOf(`sentry-webhook:sentry-internal:${wsS!.publicId}`);
  if (sSession) sessionIds.push(sSession.sessionId);
  check("triage session started in that workspace", sSession?.workspaceId === wsS!.id, JSON.stringify(sSession ?? null));
  // let both turns settle before cleanup so nothing writes to deleted rows
  await sleep(20_000);
} catch (error) {
  check(`run: ${error instanceof Error ? error.message : "error"}`, false);
} finally {
  if (sessionIds.length) await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.sessionId, sessionIds));
  await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.workspaceId, workspaceIds));
  await db.delete(schema.incidents).where(or(like(schema.incidents.sentryIssueId, `QCEVE-${RUN}-%`), inArray(schema.incidents.workspaceId, workspaceIds)));
  await db.delete(schema.webhookDeliveries).where(inArray(schema.webhookDeliveries.workspaceId, workspaceIds));
  await db.delete(schema.usageCounters).where(inArray(schema.usageCounters.scopeKey, workspaceIds.map((id) => `ws:${id}`)));
  await db.delete(schema.launches).where(inArray(schema.launches.workspaceId, workspaceIds));
  await db.delete(schema.connections).where(inArray(schema.connections.workspaceId, workspaceIds));
  await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaceIds));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
