import { eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "./db";
import { type GithubAccess, githubAccessFor } from "./github-access";
import { type ChangeReview, posthogAccessFor, reviewWorkspace } from "./launch-review";
import { sentryAccessFor } from "./sentry-access";

// Run by agent/schedules/daily-launch-review.ts (15:00 UTC). For each workspace with connections,
// review what shipped in the last 24h (merged PRs + deployed pushes, Sentry and PostHog before vs
// after) and store one `launches` row per change; the desk feed shows them. Deterministic code, no model turn: a schedule runs as the
// app principal, which only ever resolves to the demo workspace, so it can't review a team's stack
// through the chat tools. Nothing is posted anywhere unless the workspace opted in
// (`launchReviewComments: true` on its GitHub connection config), and then only one comment on
// the newest merged PR. Never rolls anything back.
const MARKER = "<!-- roary:launch-review -->";

async function commentOnNewestPr(github: Extract<GithubAccess, { ok: true }>, reviews: ChangeReview[]) {
  const newest = reviews.filter((r) => r.change.kind === "pr").sort((a, b) => b.change.shippedAt.localeCompare(a.change.shippedAt))[0];
  if (!newest) return;
  const { repo, prNumber } = newest.change;
  const token = await github.token(repo);
  const api = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" };
  // Retries and re-runs must not stack comments.
  const existing = (await (await fetch(`${api}?per_page=100`, { headers })).json()) as { body?: string }[];
  if (Array.isArray(existing) && existing.some((c) => c.body?.includes(MARKER))) return;
  const body = [
    MARKER,
    `🚀 **Launch review** (daily, last 24h)`,
    "",
    newest.summary,
    "",
    newest.assessment.reasons.length ? `What I saw: ${newest.assessment.reasons.join("; ")}.` : "",
    newest.assessment.verdict === "bad" ? "\nIf this keeps up, consider rolling back the deploy; a human needs to do that. I can open a fix PR instead." : "",
    "\n_Roary (AI teammate). This workspace opted in to launch-review comments._",
  ].join("\n");
  await fetch(api, { method: "POST", headers, body: JSON.stringify({ body }) });
}

export async function runDailyLaunchReview(opts: { now?: number } = {}) {
  const rows = await db
    .selectDistinct({ id: schema.connections.workspaceId })
    .from(schema.connections)
    .where(ne(schema.connections.status, "disabled"));
  if (!rows.length) return [];
  const workspaces = await db.select().from(schema.workspaces).where(inArray(schema.workspaces.id, rows.map((r) => r.id)));
  const outcomes: { workspaceId: number; reviewed: number; skipped?: string; failed?: string }[] = [];
  for (const workspace of workspaces) {
    try {
      const connections = await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, workspace.id));
      const resolved = { workspace, connections };
      const github = await githubAccessFor(resolved);
      const result = await reviewWorkspace(
        resolved,
        { github, sentry: await sentryAccessFor(resolved), posthog: await posthogAccessFor(resolved) },
        { sinceHours: 24, now: opts.now },
      );
      if (github.ok && github.commentsOptIn && result.reviews.length) await commentOnNewestPr(github, result.reviews);
      outcomes.push({ workspaceId: workspace.id, reviewed: result.reviews.length, skipped: result.skipped });
    } catch (error) {
      // Error names only: provider and pg messages can echo credentials.
      outcomes.push({ workspaceId: workspace.id, reviewed: 0, failed: error instanceof Error ? error.name : "unknown" });
    }
  }
  console.log("[daily-launch-review]", JSON.stringify(outcomes));
  return outcomes;
}

