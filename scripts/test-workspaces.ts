// End-to-end check of "connect your own stack": anonymous → demo workspace, signed-in user →
// their own empty workspace, then a Sentry connection row makes Roary use it for that user.
//
//   1. a Neon branch that is NOT production:  neon checkout dev-<you> && neon env pull
//   2. npm run db:migrate
//   3. npx eve dev --no-ui            (port 2000; .env.local needs CONNECTIONS_ENCRYPTION_KEY)
//   4. npx tsx --env-file=.env.local scripts/test-workspaces.ts [--keep] [--only=a,b,c]
//
// Creates a throwaway Neon Auth user (random example.com email, password never printed) and,
// unless --keep, deletes its workspace rows afterwards. Spends model credits: ~3 short turns.
import { eq, inArray } from "drizzle-orm";
import { Client, type MessageStreamEvent } from "eve/client";
import { db, schema } from "../agent/lib/db";
import { sentryAccess } from "../agent/lib/sentry-access";
import { encryptSecret, NEON_AUTH_AUTHENTICATOR } from "../agent/lib/workspace";

const EVE_URL = process.env.EVE_URL ?? "http://127.0.0.1:2000";
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? ["a", "b", "c"];

if (process.env.NEON_BRANCH === "production" || !process.env.NEON_BRANCH) {
  console.error("Refusing to run: point .env.local at a non-production Neon branch (NEON_BRANCH).");
  process.exit(2);
}
for (const name of ["NEON_AUTH_BASE_URL", "CONNECTIONS_ENCRYPTION_KEY", "SENTRY_AUTH_TOKEN", "DATABASE_URL"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in the environment.`);
    process.exit(2);
  }
}

// One read-only question that needs Sentry (and PostHog if connected) but never writes to GitHub.
const PROMPT =
  "Read-only check, please: checkout seems broken for some shoppers. Find the matching Sentry issue and tell me its short id and the top in-app stack frame (file:line). If PostHog is connected, add how many distinct users hit checkout_failed in the last 14 days. Don't save incidents, don't post or open anything on GitHub. Keep it under 120 words.";

type ToolCall = { name: string; input: unknown; output?: unknown; isError?: boolean };
type Turn = { reply: string; calls: ToolCall[]; status: string };

async function runTurn(client: Client): Promise<Turn> {
  const { response } = await client.sessions.create({ message: PROMPT });
  const calls = new Map<string, ToolCall>();
  let reply = "";
  let status = "unknown";
  for await (const event of response as AsyncIterable<MessageStreamEvent>) {
    const data = (event as { data?: any }).data ?? {};
    if (event.type === "actions.requested") {
      for (const action of data.actions ?? []) {
        calls.set(action.callId, { name: action.toolName ?? action.name, input: action.input });
      }
    } else if (event.type === "action.result") {
      const result = data.result ?? data;
      const callId = result.callId ?? data.callId;
      const call: ToolCall = calls.get(callId) ?? { name: String(result.toolName ?? "?"), input: undefined };
      call.output = result.output;
      call.isError = result.kind !== "tool-result" || Boolean(result.isError);
      calls.set(callId, call);
    } else if (event.type === "message.completed" && data.finishReason !== "tool-calls") {
      reply = String(data.message ?? "");
    } else if (event.type === "session.waiting" || event.type === "session.completed" || event.type === "session.failed") {
      status = event.type;
      if (event.type === "session.failed") reply ||= JSON.stringify(data).slice(0, 400);
      break;
    }
  }
  return { reply, calls: [...calls.values()], status };
}

const SENTRY_TOOLS = new Set(["list_sentry_issues", "get_sentry_issue"]);
const isSentry = (c: ToolCall) => SENTRY_TOOLS.has(c.name);
const isPosthog = (c: ToolCall) => c.name.startsWith("posthog__");
const isGithub = (c: ToolCall) => c.name.startsWith("github__");
const ok = (c: ToolCall) => !c.isError && !(c.output && typeof c.output === "object" && "error" in (c.output as object));
const sentryOrg = (c: ToolCall) => (c.output as { org?: string } | undefined)?.org;

function show(label: string, turn: Turn) {
  console.log(`\n--- ${label}: ${turn.status}`);
  for (const c of turn.calls) {
    const out = JSON.stringify(c.output ?? null);
    console.log(`  tool ${c.name} ${JSON.stringify(c.input)} -> ${ok(c) ? "ok" : "ERROR"} ${out.slice(0, 160)}`);
  }
  console.log(`  reply: ${turn.reply.replace(/\s+/g, " ").slice(0, 600)}`);
}

const results: { name: string; pass: boolean; why: string }[] = [];
function check(name: string, pass: boolean, why: string) {
  results.push({ name, pass, why });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${why}`);
}

async function signUpThrowawayUser(): Promise<{ userId: string; token: () => Promise<string> }> {
  const base = process.env.NEON_AUTH_BASE_URL!.replace(/\/$/, "");
  const headers = { "content-type": "application/json", origin: "http://localhost:3000" };
  const email = `roary-test-${Date.now()}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const res = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, name: "Roary workspace test" }),
  });
  if (!res.ok) throw new Error(`Neon Auth sign-up failed: ${res.status}`);
  const { user } = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const token = async () => {
    const r = await fetch(`${base}/token`, { headers: { cookie, origin: headers.origin } });
    const { token: jwt } = (await r.json()) as { token?: string };
    if (!jwt) throw new Error(`Neon Auth /token failed: ${r.status}`);
    return jwt;
  };
  console.log(`signed up throwaway Neon Auth user ${user.id} (${email.replace(/^[^@]+/, "roary-test-…")})`);
  return { userId: user.id, token };
}

async function userWorkspaces(userId: string) {
  return db
    .select({ workspace: schema.workspaces })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId));
}

const anonymous = new Client({ host: EVE_URL });
await anonymous.health();

// (a) Anonymous: the demo workspace, exactly like before.
if (only.includes("a")) {
  const turn = await runTurn(anonymous);
  show("(a) anonymous", turn);
  const sentry = turn.calls.filter(isSentry);
  check(
    "(a) anonymous uses the demo Sentry project",
    sentry.some(ok) && sentry.filter(ok).every((c) => !sentryOrg(c) || sentryOrg(c) === "roary") && /JAVASCRIPT-NEXTJS-K4|lineTotal|checkout/i.test(turn.reply),
    `${sentry.length} Sentry call(s), ${sentry.filter(ok).length} ok; reply mentions the checkout issue: ${/JAVASCRIPT-NEXTJS-K4|lineTotal/i.test(turn.reply)}`,
  );
  check(
    "(a) anonymous PostHog works via the demo key",
    turn.calls.filter(isPosthog).some(ok),
    `${turn.calls.filter(isPosthog).length} PostHog call(s), ${turn.calls.filter(isPosthog).filter(ok).length} ok`,
  );
}

let user: Awaited<ReturnType<typeof signUpThrowawayUser>> | undefined;
if (only.includes("b") || only.includes("c")) {
  user = await signUpThrowawayUser();

  // A forged/garbled Neon token must be rejected, not downgraded to guest.
  const bad = (await user.token()).replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
  const res = await fetch(`${EVE_URL}/eve/v1/session`, { method: "POST", headers: { authorization: `Bearer ${bad}` } });
  check("(b) tampered Neon Auth JWT is rejected", res.status === 401, `POST /eve/v1/session -> ${res.status}`);
}

const signedIn = user ? new Client({ host: EVE_URL, auth: { bearer: user.token }, redirect: "error" }) : undefined;

// (b) Signed in, nothing connected: own empty workspace, no demo data.
if (user && signedIn && only.includes("b")) {
  const turn = await runTurn(signedIn);
  show("(b) signed in, no connections", turn);
  const workspaces = await userWorkspaces(user.userId);
  const ws = workspaces[0]?.workspace;
  const conns = ws ? await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, ws.id)) : [];
  check(
    "(b) user got their own empty workspace",
    workspaces.length === 1 && ws?.isDemo === false && ws.ownerUserId === user.userId && conns.length === 0,
    `${workspaces.length} workspace(s); isDemo=${ws?.isDemo}; ${conns.length} connection(s)`,
  );
  // Deterministic, model-free: the Sentry chokepoint refuses this workspace outright.
  const principal = { authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: user.userId };
  const access = await sentryAccess({ session: { auth: { current: principal, initiator: principal } } });
  check(
    "(b) Sentry tools refuse the empty workspace (no demo token fallback)",
    !access.ok && access.error === "no_sentry_connection",
    JSON.stringify(access.ok ? { ok: true, org: access.org } : { ok: false, error: access.error }),
  );
  const leaked = turn.calls.filter((c) => (isSentry(c) || isPosthog(c) || isGithub(c)) && ok(c));
  check(
    "(b) no demo data used",
    leaked.length === 0 && !/JAVASCRIPT-NEXTJS-K4|lineTotal/i.test(turn.reply),
    leaked.length ? `successful calls: ${leaked.map((c) => c.name).join(", ")}` : "no successful Sentry/PostHog/GitHub calls; reply has no demo issue",
  );
  check(
    "(b) Roary says nothing is connected yet",
    /connect/i.test(turn.reply) && /sentry/i.test(turn.reply),
    "reply mentions connecting Sentry",
  );
}

// (c) Insert a Sentry connection for that workspace: Roary now uses it for this user.
if (user && signedIn && only.includes("c")) {
  let ws = (await userWorkspaces(user.userId))[0]?.workspace;
  if (!ws) {
    // Running c alone: one turn creates the workspace on first touch.
    await runTurn(signedIn);
    ws = (await userWorkspaces(user.userId))[0]!.workspace;
  }
  await db
    .insert(schema.connections)
    .values({
      workspaceId: ws.id,
      provider: "sentry",
      status: "connected",
      config: { org: "roary", project: "javascript-nextjs-k4" },
      secretCiphertext: encryptSecret(process.env.SENTRY_AUTH_TOKEN!),
    })
    .onConflictDoNothing();
  console.log(`inserted sentry connection for workspace ${ws.id} (token encrypted)`);

  const principal = { authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: user.userId };
  const access = await sentryAccess({ session: { auth: { current: principal, initiator: principal } } });
  check(
    "(c) Sentry access now resolves to this workspace's decrypted token",
    access.ok && access.workspaceId === ws.id && access.token === process.env.SENTRY_AUTH_TOKEN,
    JSON.stringify(access.ok ? { ok: true, workspaceId: access.workspaceId, org: access.org, project: access.project } : access),
  );

  const turn = await runTurn(signedIn);
  show("(c) signed in, Sentry connected", turn);
  const sentry = turn.calls.filter(isSentry);
  check(
    "(c) Roary uses the workspace's Sentry connection",
    sentry.some(ok) && /JAVASCRIPT-NEXTJS-K4|lineTotal/i.test(turn.reply),
    `${sentry.length} Sentry call(s), ${sentry.filter(ok).length} ok`,
  );
  const posthogOk = turn.calls.filter(isPosthog).filter(ok);
  check(
    "(c) PostHog stays unconnected for this user",
    posthogOk.length === 0,
    `${turn.calls.filter(isPosthog).length} PostHog call(s), ${posthogOk.length} ok`,
  );
  check("(c) still one workspace for the user", (await userWorkspaces(user.userId)).length === 1, "no duplicate workspace");
}

if (user && !keep) {
  const ids = (await userWorkspaces(user.userId)).map((r) => r.workspace.id);
  if (ids.length) {
    await db.delete(schema.connections).where(inArray(schema.connections.workspaceId, ids));
    await db.delete(schema.workspaceMembers).where(inArray(schema.workspaceMembers.workspaceId, ids));
    await db.update(schema.incidents).set({ workspaceId: null }).where(inArray(schema.incidents.workspaceId, ids));
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, ids));
  }
  console.log(`cleaned up ${ids.length} test workspace(s)`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
