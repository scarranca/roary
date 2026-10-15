// Chat ownership + usage limits, end to end against a running eve channel.
//
// Local (writes test rows to a NON-production Neon branch, then deletes them):
//   1. neon env pull --project-id young-surf-15904408 --branch dev-<you>   (+ CONNECTIONS_ENCRYPTION_KEY, VERCEL_OIDC_TOKEN)
//   2. npm run db:migrate
//   3. ROARY_GUEST_MSGS_PER_HOUR=3 ROARY_USER_MSGS_PER_HOUR=6 npx eve dev --no-ui
//   4. (optional, web checks) npx next dev apps/web -p 3101 with the same env, and WEB_URL=http://localhost:3101
//   5. ROARY_GUEST_MSGS_PER_HOUR=3 ROARY_USER_MSGS_PER_HOUR=6 npx tsx --env-file=.env.local scripts/test-sessions-and-limits.ts
//
// Production smoke (no database access, no seeding; two anonymous browsers via the real proxy cookie):
//   BASE_URL=https://roary-rho.vercel.app npx tsx scripts/test-sessions-and-limits.ts --prod-smoke
//
// Spends model credits: ~8 one-word turns locally, 1 in --prod-smoke. Never prints tokens or cookies.
import { and, eq, inArray, like, sql } from "drizzle-orm";

const args = process.argv.slice(2);
const prodSmoke = args.includes("--prod-smoke");
const EVE_URL = (process.env.BASE_URL ?? process.env.EVE_URL ?? "http://127.0.0.1:2000").replace(/\/$/, "");
const WEB_URL = (process.env.BASE_URL ?? process.env.WEB_URL ?? "").replace(/\/$/, "");
const PROMPT = "Reply with just the word OK.";

type Who = { readonly cookie?: string; readonly bearer?: string; readonly label: string };
type Result = { name: string; pass: boolean; why: string };
const results: Result[] = [];
function check(name: string, pass: boolean, why = "") {
  results.push({ name, pass, why });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${why ? `: ${why}` : ""}`);
}

function headers(who: Who, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (who.cookie) h.cookie = who.cookie;
  if (who.bearer) h.authorization = `Bearer ${who.bearer}`;
  if (json) h["content-type"] = "application/json";
  return h;
}

async function post(path: string, who: Who, body?: object) {
  const res = await fetch(`${EVE_URL}${path}`, {
    method: "POST",
    headers: headers(who, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

/** Follows the stream (replayed from the start) until turn number `turn` settles; returns its reply. */
async function follow(sessionId: string, who: Who, turn = 1, timeoutMs = 120_000): Promise<{ status: number; reply: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${EVE_URL}/eve/v1/session/${sessionId}/stream`, { headers: headers(who), signal: ac.signal });
    if (!res.ok || !res.body) return { status: res.status, reply: "" };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let reply = "";
    let turns = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as { type: string; data?: any };
        if (ev.type === "turn.started") turns += 1;
        if (turns === turn && ev.type === "message.completed" && ev.data?.finishReason !== "tool-calls") reply = String(ev.data?.message ?? "");
        if (turns >= turn && (ev.type === "session.waiting" || ev.type === "session.failed" || ev.type === "session.completed")) {
          await reader.cancel().catch(() => {});
          return { status: res.status, reply };
        }
      }
    }
    return { status: res.status, reply };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads recorded history without following; returns status and how many turns (user messages) it has. */
async function history(sessionId: string, who: Who): Promise<{ status: number; userMessages: number }> {
  const res = await fetch(`${EVE_URL}/eve/v1/session/${sessionId}/stream?follow=false`, { headers: headers(who) });
  const text = await res.text();
  if (!res.ok) return { status: res.status, userMessages: 0 };
  const userMessages = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string })
    .filter((e) => e.type === "turn.started").length;
  return { status: res.status, userMessages };
}

async function chat(who: Who, sessionId?: string) {
  const before = sessionId ? (await history(sessionId, who)).userMessages : 0;
  const res = sessionId
    ? await post(`/eve/v1/session/${sessionId}`, who, { message: PROMPT })
    : await post("/eve/v1/session", who, { message: PROMPT });
  const id = (res.json.sessionId as string | undefined) ?? sessionId;
  if (res.status !== 202 || !id) return { ...res, id, reply: "" };
  const { reply } = await follow(id, who, before + 1);
  return { ...res, id, reply };
}

/** A browser's guest cookie, as the web app's proxy hands it out on the first page load. */
async function browserGuest(label: string): Promise<Who> {
  const res = await fetch(`${WEB_URL}/desk`, { redirect: "manual" });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith("roary_guest="));
  return { cookie, label };
}

// ---------------------------------------------------------------------------------------------

if (prodSmoke) {
  if (!WEB_URL) throw new Error("--prod-smoke needs BASE_URL");
  for (const path of ["/", "/desk", "/hire"]) {
    const res = await fetch(`${WEB_URL}${path}`);
    check(`page ${path} is 200`, res.status === 200, String(res.status));
  }
  const a = await browserGuest("browser A");
  const b = await browserGuest("browser B");
  check("the proxy hands each browser a guest cookie", Boolean(a.cookie && b.cookie && a.cookie !== b.cookie));
  const first = await chat(a);
  check("anonymous browser A: create is 202 and Roary answers", first.status === 202 && first.reply.length > 0, `${first.status}, reply ${JSON.stringify(first.reply.slice(0, 40))}`);
  const own = await history(first.id!, a);
  check("browser A reads its own chat", own.status === 200 && own.userMessages >= 1, String(own.status));
  const other = await history(first.id!, b);
  check("browser B can't read browser A's chat", other.status === 403, String(other.status));
  const steal = await post(`/eve/v1/session/${first.id}`, b, { message: "hi" });
  check("browser B can't post into browser A's chat", steal.status === 403, String(steal.status));
  const bare = await post("/eve/v1/session", { label: "no cookie" }, { message: PROMPT });
  check("a cookie-less caller is refused (401)", bare.status === 401, String(bare.status));
  const page = await fetch(`${WEB_URL}/desk/s/${first.id}`, { headers: { cookie: b.cookie! } });
  check("browser B gets a 404 page for browser A's link", page.status === 404, String(page.status));
  finish();
}

const { db, schema } = await import("../agent/lib/db");
const { newGuestId, signGuestId } = await import("../agent/lib/crypto");
const { limitConfig, windowStart } = await import("../agent/lib/usage-limits");
const { NEON_AUTH_AUTHENTICATOR, resolveWorkspace } = await import("../agent/lib/workspace");

if (process.env.NEON_BRANCH === "production" || !process.env.NEON_BRANCH) {
  console.error("Refusing to run: point .env.local at a non-production Neon branch (NEON_BRANCH).");
  process.exit(2);
}
for (const name of ["NEON_AUTH_BASE_URL", "CONNECTIONS_ENCRYPTION_KEY", "DATABASE_URL"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in the environment.`);
    process.exit(2);
  }
}
const limits = limitConfig();
if (limits.guestPerHour < 2 || limits.userPerHour <= limits.guestPerHour) {
  console.error("Run eve dev and this script with ROARY_GUEST_MSGS_PER_HOUR=3 ROARY_USER_MSGS_PER_HOUR=6 (user > guest).");
  process.exit(2);
}

const guestIds: string[] = [];
function guest(label: string): Who & { id: string } {
  const id = newGuestId();
  guestIds.push(id);
  return { id, cookie: `roary_guest=${signGuestId(id)}`, label };
}

const users: { userId: string; workspaceId: number }[] = [];
async function user(label: string): Promise<Who & { userId: string; workspaceId: number }> {
  const base = process.env.NEON_AUTH_BASE_URL!.replace(/\/$/, "");
  const h = { "content-type": "application/json", origin: "http://localhost:3000" };
  const email = `roary-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const res = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email, password: `${crypto.randomUUID()}Aa1!`, name: "Roary sessions test" }),
  });
  if (!res.ok) throw new Error(`Neon Auth sign-up failed: ${res.status}`);
  const { user: u } = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const tok = await fetch(`${base}/token`, { headers: { cookie, origin: h.origin } });
  const { token } = (await tok.json()) as { token?: string };
  if (!token) throw new Error(`Neon Auth /token failed: ${tok.status}`);
  const { workspace } = await resolveWorkspace({ authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: u.id });
  users.push({ userId: u.id, workspaceId: workspace.id });
  return { bearer: token, label, userId: u.id, workspaceId: workspace.id };
}

async function seed(scope: string, period: "hour" | "day", values: { messages?: number; costUsd?: number }) {
  await db
    .insert(schema.usageCounters)
    .values({ scopeKey: scope, period, windowStart: windowStart(period), messages: values.messages ?? 0, costUsd: values.costUsd ?? 0 })
    .onConflictDoUpdate({
      target: [schema.usageCounters.scopeKey, schema.usageCounters.period, schema.usageCounters.windowStart],
      set: { messages: values.messages ?? 0, costUsd: values.costUsd ?? 0 },
    });
}

async function counter(scope: string, period: "hour" | "day") {
  const [row] = await db
    .select()
    .from(schema.usageCounters)
    .where(and(eq(schema.usageCounters.scopeKey, scope), eq(schema.usageCounters.period, period), eq(schema.usageCounters.windowStart, windowStart(period))));
  return row;
}

const sessionIds: string[] = [];
const track = (id?: string) => id && sessionIds.push(id);

try {
  const g1 = guest("guest 1");
  const g2 = guest("guest 2");
  const u1 = await user("user 1");
  const u2 = await user("user 2");

  // ---- A. guests own their chats ----------------------------------------------------------
  const a1 = await chat(g1);
  track(a1.id);
  check("A1 guest flow: create is 202 and Roary answers (stream right after create)", a1.status === 202 && /ok/i.test(a1.reply), `${a1.status}, reply ${JSON.stringify(a1.reply.slice(0, 30))}`);
  const a2 = await chat(g1, a1.id);
  check("A2 owner continues their chat", a2.status === 202 && /ok/i.test(a2.reply), String(a2.status));
  const a3 = await history(a1.id!, g1);
  check("A3 owner reads their history", a3.status === 200 && a3.userMessages === 2, `${a3.status}, ${a3.userMessages} messages`);
  const a4 = await history(a1.id!, g2);
  check("A4 another guest can't read it", a4.status === 403, String(a4.status));
  const a5 = await post(`/eve/v1/session/${a1.id}`, g2, { message: "what did they ask?" });
  check("A5 another guest can't continue it", a5.status === 403, String(a5.status));
  const a6 = await post(`/eve/v1/session/${a1.id}/reset`, g2);
  const a6b = await post(`/eve/v1/session/${a1.id}/cancel`, g2);
  check("A6 another guest can't cancel or reset it", a6.status === 403 && a6b.status === 403, `${a6.status}/${a6b.status}`);
  const forged = { cookie: `roary_guest=${g1.id}.${"A".repeat(43)}`, label: "forged" };
  const a7 = await history(a1.id!, forged);
  check("A7 a forged guest cookie with the owner's id can't read it", a7.status === 403, String(a7.status));
  const a8 = await history(a1.id!, u2);
  check("A8 a signed-in user can't read a guest's chat", a8.status === 403, String(a8.status));
  const a9 = await fetch(`${EVE_URL}/eve/v1/session/..%2F${a1.id}/stream`, { headers: headers(g2) });
  check("A9 a malformed session id is refused", a9.status === 403 || a9.status === 404, String(a9.status));

  // ---- B. signed-in users own theirs ------------------------------------------------------
  const b1 = await chat(u1);
  track(b1.id);
  check("B1 signed-in user: create is 202 and Roary answers", b1.status === 202 && /ok/i.test(b1.reply), String(b1.status));
  check("B2 owner reads their history", (await history(b1.id!, u1)).status === 200);
  check("B3 another user can't read it", (await history(b1.id!, u2)).status === 403);
  check("B4 a guest can't read it", (await history(b1.id!, g1)).status === 403);
  const signedInG1 = { bearer: u1.bearer, cookie: g1.cookie, label: "guest 1 after signing in" };
  check("B5 a guest who signs in (same browser) still opens their guest chat", (await history(a1.id!, signedInG1)).status === 200);
  const [row] = await db.select().from(schema.chatSessions).where(eq(schema.chatSessions.sessionId, b1.id!));
  check("B6 ownership row records the user and their workspace", row?.ownerKey === `neon-auth:${u1.userId}` && row?.workspaceId === u1.workspaceId);

  // ---- B'. prewarm (bodyless create) is claimed by the first message and isn't counted ------
  const g3 = guest("guest 3");
  const pre = await post("/eve/v1/session", g3);
  track(pre.json.sessionId);
  check("B7 bodyless prewarm create is 202 and not counted", pre.status === 202 && !(await counter(`guest:${g3.id}`, "hour")), String(pre.status));
  const preTurn = await chat(g3, pre.json.sessionId);
  check("B8 first message on a prewarmed session works and counts once", preTurn.status === 202 && (await counter(`guest:${g3.id}`, "hour"))?.messages === 1);
  check("B9 nobody else can read the prewarmed session", (await history(pre.json.sessionId, g2)).status === 403);

  // ---- C. limits --------------------------------------------------------------------------
  const g4 = guest("guest 4");
  await seed(`guest:${g4.id}`, "hour", { messages: limits.guestPerHour - 1 });
  const c1 = await chat(g4);
  track(c1.id);
  check(`C1 guest's message ${limits.guestPerHour}/${limits.guestPerHour} goes through`, c1.status === 202);
  const c2 = await post(`/eve/v1/session/${c1.id}`, g4, { message: PROMPT });
  const friendly = String(c2.json.error ?? "");
  check(
    "C2 the next one gets the friendly 429",
    c2.status === 429 && c2.json.code === "rate_limited" && friendly.includes("taking a breather") && /Resets in \d/.test(friendly) && Number(c2.headers.get("retry-after")) > 0,
    `${c2.status} ${JSON.stringify(friendly)}`,
  );
  check("C3 a refused message isn't counted", (await counter(`guest:${g4.id}`, "hour"))?.messages === limits.guestPerHour);
  await db
    .update(schema.usageCounters)
    .set({ windowStart: sql`${schema.usageCounters.windowStart} - interval '1 hour'` })
    .where(and(eq(schema.usageCounters.scopeKey, `guest:${g4.id}`), eq(schema.usageCounters.period, "hour")));
  const c4 = await chat(g4, c1.id);
  check("C4 the limit resets with the next hour", c4.status === 202 && /ok/i.test(c4.reply), String(c4.status));

  await seed(`ws:${u1.workspaceId}`, "hour", { messages: limits.guestPerHour });
  const c5 = await chat(u1, b1.id);
  check(`C5 signed-in limits differ: a workspace past the guest cap (${limits.guestPerHour}) still chats`, c5.status === 202, String(c5.status));
  await seed(`ws:${u1.workspaceId}`, "hour", { messages: limits.userPerHour });
  const c6 = await post(`/eve/v1/session/${b1.id}`, u1, { message: PROMPT });
  check(
    `C6 ...and stops at the workspace cap (${limits.userPerHour})`,
    c6.status === 429 && String(c6.json.error).includes(`workspace limit of ${limits.userPerHour}`) && !String(c6.json.error).includes("Sign in"),
    `${c6.status} ${JSON.stringify(c6.json.error)}`,
  );

  const g5 = guest("guest 5");
  await seed(`guest:${g5.id}`, "day", { messages: limits.guestPerDay });
  const c7 = await post("/eve/v1/session", g5, { message: PROMPT });
  check("C7 the daily cap applies too", c7.status === 429 && c7.json.reason === "daily", `${c7.status} ${c7.json.reason}`);

  const g6 = guest("guest 6");
  await seed(`guest:${g6.id}`, "day", { costUsd: limits.guestUsdPerDay });
  const c8 = await post("/eve/v1/session", g6, { message: PROMPT });
  check("C8 the daily spend budget applies", c8.status === 429 && c8.json.reason === "budget" && String(c8.json.error).includes("budget"), `${c8.status} ${c8.json.reason}`);

  let spent = await counter(`guest:${g1.id}`, "day");
  for (let i = 0; i < 10 && !(spent && spent.costUsd > 0); i++) {
    await new Promise((r) => setTimeout(r, 500));
    spent = await counter(`guest:${g1.id}`, "day");
  }
  check("C9 model spend is recorded per guest from step.completed", Boolean(spent && spent.costUsd > 0 && spent.inputTokens > 0), `$${spent?.costUsd.toFixed(4)} ${spent?.inputTokens} in-tokens`);

  // ---- D. web routes ----------------------------------------------------------------------
  if (WEB_URL) {
    const desk = await fetch(`${WEB_URL}/desk`, { redirect: "manual" });
    const set = desk.headers.getSetCookie().find((c) => c.startsWith("roary_guest="));
    check("D1 /desk hands a new browser a signed httpOnly guest cookie", desk.status === 200 && Boolean(set && /HttpOnly/i.test(set)), String(desk.status));
    const mine = await fetch(`${WEB_URL}/desk/s/${a1.id}`, { headers: { cookie: g1.cookie! } });
    check("D2 /desk/s/<id> opens for its owner", mine.status === 200, String(mine.status));
    const theirs = await fetch(`${WEB_URL}/desk/s/${a1.id}`, { headers: { cookie: g2.cookie! } });
    check("D3 /desk/s/<id> is a 404 for anyone else", theirs.status === 404, String(theirs.status));
  } else {
    console.log("(skipping web checks; set WEB_URL to a running `next dev apps/web`)");
  }
} catch (error) {
  check("script ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  if (!args.includes("--keep")) {
    if (sessionIds.length) await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.sessionId, sessionIds));
    for (const id of guestIds) await db.delete(schema.usageCounters).where(eq(schema.usageCounters.scopeKey, `guest:${id}`));
    const wsIds = users.map((u) => u.workspaceId);
    if (wsIds.length) {
      await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.workspaceId, wsIds));
      for (const id of wsIds) await db.delete(schema.usageCounters).where(like(schema.usageCounters.scopeKey, `ws:${id}`));
      await db.delete(schema.workspaceMembers).where(inArray(schema.workspaceMembers.workspaceId, wsIds));
      await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, wsIds));
    }
    console.log(`cleaned up ${sessionIds.length} session row(s), ${guestIds.length} guest(s), ${wsIds.length} workspace(s)`);
  }
  finish();
}

function finish(): never {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
