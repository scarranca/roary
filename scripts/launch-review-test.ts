// Launch review end to end against the demo workspace's real Sentry, PostHog and GitHub (read-only),
// writing `launches` rows only on a non-production Neon branch.
//
//   neon env pull --project-id young-surf-15904408 --branch dev-connect --file .env.devconnect
//   (+ SENTRY_AUTH_TOKEN, POSTHOG_API_KEY, VERCEL_OIDC_TOKEN, CONNECTIONS_ENCRYPTION_KEY from .env.local)
//   npx tsx --env-file=.env.devconnect scripts/launch-review-test.ts
//
// HOURS=48 widens the look-back once 8d41418 (deployed 2026-10-14T20:43Z) is older than 24h.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { runDailyLaunchReview } from "../agent/lib/daily-launch-review";
import { db, schema } from "../agent/lib/db";
import { githubAccessFor } from "../agent/lib/github-access";
import {
  assessChange,
  compareWindow,
  healthLine,
  listShippedChanges,
  posthogAccessFor,
  posthogEventDelta,
  reviewWorkspace,
  saveLaunchReview,
  sentryErrorDelta,
} from "../agent/lib/launch-review";
import { sentryAccessFor } from "../agent/lib/sentry-access";
import { resolveWorkspace } from "../agent/lib/workspace";

const REPO = "scarranca/roary-demo-shop";
const SHA = "8d41418";
const HOURS = Number(process.env.HOURS ?? 24);
const results: { test: string; ok: boolean; detail: string }[] = [];
async function check(test: string, fn: () => Promise<string>) {
  try {
    results.push({ test, ok: true, detail: await fn() });
  } catch (error) {
    results.push({ test, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

const demo = await resolveWorkspace(null);
assert.ok(demo.workspace.isDemo, "guest must resolve to the demo workspace");
const github = await githubAccessFor(demo);
const sentry = await sentryAccessFor(demo);
const posthog = await posthogAccessFor(demo);
assert.ok(github.ok && sentry.ok && posthog.ok, "demo workspace must have GitHub, Sentry and PostHog access");

let anchor = "";
await check(`GitHub: what shipped to ${REPO} in ${HOURS}h`, async () => {
  const { changes } = await listShippedChanges(await github.token(REPO), REPO, HOURS);
  for (const c of changes) {
    console.log(`  ${c.kind} ${c.prNumber ? `#${c.prNumber}` : c.sha.slice(0, 7)} "${c.title}" shipped ${c.shippedAt} deployed ${c.deployedAt ?? "-"} anchor(${c.anchorSource}) ${c.anchor}`);
  }
  const target = changes.find((c) => c.sha.startsWith(SHA));
  assert.ok(target, `${SHA} not in the last ${HOURS}h (try HOURS=48)`);
  assert.equal(target.anchorSource, "production_deploy");
  anchor = target.anchor;
  const prs = changes.filter((c) => c.kind === "pr").length;
  return `${changes.length} changes (${prs} merged PRs, ${changes.length - prs} direct pushes); ${SHA} deployed to production at ${anchor} (${target.deploymentUrl})`;
});

const window = compareWindow(anchor || "2026-10-14T20:43:04Z", 6);
assert.ok(!("error" in window));
let s: Awaited<ReturnType<typeof sentryErrorDelta>> | null = null;
let p: Awaited<ReturnType<typeof posthogEventDelta>> | null = null;

await check(`Sentry: errors ${window.hours}h before vs after the ${SHA} deploy`, async () => {
  s = await sentryErrorDelta(sentry, window);
  const top = s.newIssues[0];
  assert.ok(top, "expected a new issue after the deploy");
  assert.ok(s.after.events > s.before.events);
  return `events ${s.before.events} → ${s.after.events}, issues ${s.before.issues} → ${s.after.issues}; new: ${top.shortId} "${top.title}" (${top.events} events, ${top.users} users, first seen ${top.firstSeen})`;
});

await check(`PostHog: checkout_failed ${window.hours}h before vs after`, async () => {
  p = await posthogEventDelta(posthog, window, ["checkout_failed", "checkout_completed", "add_to_cart"]);
  const failed = p.events.find((e) => e.event === "checkout_failed")!;
  assert.ok(failed.after > failed.before, "checkout_failed should rise after the deploy");
  return p.events.map((e) => `${e.event} ${e.before} → ${e.after} (users ${e.usersBefore} → ${e.usersAfter})`).join("; ") + `; all events ${p.totals.before} → ${p.totals.after}`;
});

await check("PostHog: auto-picked events include failures", async () => {
  const auto = await posthogEventDelta(posthog, window, undefined);
  assert.ok(auto.events.some((e) => e.event === "checkout_failed"));
  return auto.events.map((e) => `${e.event} ${e.before}→${e.after}`).join(", ");
});

let summary = "";
await check("Assessment + health line", async () => {
  const a = assessChange({ window, sentry: s, posthog: p, overlapping: 0 });
  assert.equal(a.verdict, "bad");
  summary = healthLine(a, s, p, window);
  return `${a.verdict}/${a.confidence}: ${a.reasons.join("; ")}\n    → ${summary}`;
});

await check("Window clipping: a change 1h ago compares 1h vs 1h", async () => {
  const w = compareWindow(new Date(Date.now() - 3_600_000).toISOString(), 6);
  assert.ok(!("error" in w) && Math.abs(w.hours - 1) < 0.01);
  assert.ok("error" in compareWindow(new Date(Date.now() + 60_000).toISOString(), 6));
  return "ok";
});

await check("Signed-in workspace without GitHub never borrows the demo's", async () => {
  const [other] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.isDemo, false)).limit(1);
  if (!other) return "skipped (no signed-in workspace on this branch)";
  const resolved = { workspace: other, connections: await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, other.id)) };
  const gh = await githubAccessFor(resolved);
  const hasGithub = resolved.connections.some((c) => c.provider === "github");
  if (!hasGithub) assert.equal(gh.ok, false);
  const review = await reviewWorkspace(resolved, { github: gh, sentry: await sentryAccessFor(resolved), posthog: await posthogAccessFor(resolved) }, { sinceHours: HOURS });
  return `workspace ${other.id}: github ${gh.ok ? "connected" : (gh as { error: string }).error}; daily review ${review.skipped ? `skipped (${review.skipped})` : `${review.reviews.length} reviews`}`;
});

if (process.env.NEON_BRANCH === "production") {
  results.push({ test: "launches writes", ok: true, detail: "skipped on production" });
} else {
  await check(`launches: save is idempotent and workspace-scoped (${process.env.NEON_BRANCH})`, async () => {
    const row = { repo: REPO, prNumber: null, sha: SHA, title: "Add bundle discount for multi-item carts", healthSummary: summary };
    const a = await saveLaunchReview(demo.workspace.id, row);
    const b = await saveLaunchReview(demo.workspace.id, { ...row, healthSummary: `${summary} ` });
    assert.equal(a.id, b.id);
    assert.equal(b.workspaceId, demo.workspace.id);
    return `row ${a.id}: "${b.title}" pr_number=${b.prNumber}`;
  });
  await check("Daily schedule run (all workspaces, posts nothing by default)", async () => {
    assert.equal(github.commentsOptIn, false, "demo must not be opted in to PR comments");
    const outcomes = await runDailyLaunchReview({ now: HOURS > 24 ? Date.parse("2026-10-15T12:00:00Z") : undefined });
    const demoOutcome = outcomes.find((o) => o.workspaceId === demo.workspace.id);
    assert.ok(demoOutcome && demoOutcome.reviewed >= 1 && !demoOutcome.failed, JSON.stringify(outcomes));
    const [row] = await db.select().from(schema.launches).where(eq(schema.launches.workspaceId, demo.workspace.id)).orderBy(schema.launches.id);
    assert.ok(row);
    return outcomes.map((o) => `workspace ${o.workspaceId}: ${o.failed ? `failed (${o.failed})` : o.skipped ? `skipped (${o.skipped})` : `${o.reviewed} reviewed`}`).join("; ");
  });
}

console.log("\n| Test | Result | Detail |\n|---|---|---|");
for (const r of results) console.log(`| ${r.test} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail.replace(/\n\s*/g, " ")} |`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
