import { and, eq, like, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { GithubAccess } from "./github-access";
import type { SentryAccess } from "./sentry-access";
import { credentialFor, findConnection, type ResolvedWorkspace } from "./workspace";

// Launch review data: what shipped (GitHub), and how errors (Sentry) and usage (PostHog) moved
// around each change. Pure functions over a workspace's access objects, shared by the chat tools
// (agent/tools/{list_merged_prs,sentry_error_delta,posthog_event_delta}.ts) and the daily schedule.

const GITHUB_API = "https://api.github.com";
const SENTRY_API = "https://sentry.io/api/0";
const HOUR = 3_600_000;
// Shorter than this after a change and the "after" window says nothing yet.
const MIN_SPAN_MS = 30 * 60_000;
const FAILURE_EVENT = /fail|error|exception|crash/i;

// ---------------------------------------------------------------------------------------------
// GitHub: what shipped

export type ShippedChange = {
  kind: "pr" | "commit";
  repo: string;
  prNumber: number | null;
  title: string;
  url: string;
  authors: string[];
  sha: string;
  shippedAt: string; // merged_at for a PR, commit time for a direct push
  deployedAt: string | null; // the production deployment of exactly this sha, if any
  deploymentUrl: string | null;
  anchor: string; // the moment to compare before vs after: deployedAt ?? shippedAt
  anchorSource: "production_deploy" | "merge" | "commit";
};

async function gh<T>(token: string, path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

type GhPull = { number: number; title: string; html_url: string; user: { login: string } | null; merged_at: string | null; merge_commit_sha: string | null; base: { ref: string } };
type GhCommit = { sha: string; html_url: string; parents: unknown[]; author: { login: string } | null; commit: { message: string; author: { name: string } | null; committer: { date: string } | null } };
type GhDeployment = { id: number; sha: string; environment: string; production_environment?: boolean; created_at: string };
type GhStatus = { state: string; created_at: string; environment_url?: string };

/**
 * PRs merged and commits pushed to the default branch in the last `sinceHours`, each with the
 * production deployment of its sha when GitHub knows one (Vercel and most CI report deployments
 * to GitHub). Newest first.
 */
export async function listShippedChanges(
  token: string,
  repo: string,
  sinceHours: number,
  opts: { now?: number; signal?: AbortSignal } = {},
): Promise<{ repo: string; since: string; changes: ShippedChange[] }> {
  const now = opts.now ?? Date.now();
  const since = new Date(now - sinceHours * HOUR).toISOString();
  const [pulls, commits, deployments] = await Promise.all([
    gh<GhPull[]>(token, `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, opts.signal),
    gh<GhCommit[]>(token, `/repos/${repo}/commits?since=${since}&per_page=50`, opts.signal),
    // Deployments are optional: an installation without deployments:read still gets merges.
    gh<GhDeployment[]>(token, `/repos/${repo}/deployments?per_page=50`, opts.signal).catch(() => [] as GhDeployment[]),
  ]);

  const production = deployments.filter((d) => d.production_environment === true || /^production$/i.test(d.environment));
  async function deployOf(sha: string): Promise<{ at: string; url: string | null } | null> {
    const deployment = production.find((d) => d.sha === sha);
    if (!deployment) return null;
    const statuses = await gh<GhStatus[]>(token, `/repos/${repo}/deployments/${deployment.id}/statuses?per_page=10`, opts.signal).catch(() => []);
    const success = statuses.find((s) => s.state === "success");
    return { at: success?.created_at ?? deployment.created_at, url: success?.environment_url ?? null };
  }

  const merged = pulls.filter((p) => p.merged_at && p.merged_at >= since);
  const mergeShas = new Set(merged.map((p) => p.merge_commit_sha));
  // Commits that aren't a PR's merge commit. A merge-commit PR also brings its branch commits
  // along, so ask GitHub which PR (if any) each candidate belongs to (bounded).
  const candidates = commits.filter((c) => !mergeShas.has(c.sha) && c.parents.length < 2).slice(0, 15);
  const direct = (
    await Promise.all(
      candidates.map(async (c) => {
        const prs = await gh<{ merged_at: string | null }[]>(token, `/repos/${repo}/commits/${c.sha}/pulls`, opts.signal).catch(() => []);
        return prs.some((p) => p.merged_at) ? null : c;
      }),
    )
  ).filter((c): c is GhCommit => c !== null);

  const changes: ShippedChange[] = await Promise.all([
    ...merged.map(async (p): Promise<ShippedChange> => {
      const deploy = p.merge_commit_sha ? await deployOf(p.merge_commit_sha) : null;
      return {
        kind: "pr",
        repo,
        prNumber: p.number,
        title: p.title,
        url: p.html_url,
        authors: p.user ? [p.user.login] : [],
        sha: p.merge_commit_sha ?? "",
        shippedAt: p.merged_at!,
        deployedAt: deploy?.at ?? null,
        deploymentUrl: deploy?.url ?? null,
        anchor: deploy?.at ?? p.merged_at!,
        anchorSource: deploy ? "production_deploy" : "merge",
      };
    }),
    ...direct.map(async (c): Promise<ShippedChange> => {
      const deploy = await deployOf(c.sha);
      const committedAt = c.commit.committer?.date ?? since;
      return {
        kind: "commit",
        repo,
        prNumber: null,
        title: c.commit.message.split("\n")[0]!.slice(0, 120),
        url: c.html_url,
        authors: [c.author?.login ?? c.commit.author?.name ?? "unknown"],
        sha: c.sha,
        shippedAt: committedAt,
        deployedAt: deploy?.at ?? null,
        deploymentUrl: deploy?.url ?? null,
        anchor: deploy?.at ?? committedAt,
        anchorSource: deploy ? "production_deploy" : "commit",
      };
    }),
  ]);
  changes.sort((a, b) => b.anchor.localeCompare(a.anchor));
  return { repo, since, changes };
}

// ---------------------------------------------------------------------------------------------
// Comparison windows

export type Window = { before: { start: string; end: string }; after: { start: string; end: string }; hours: number };

/**
 * Equal-length windows on both sides of `at`. The after window is clipped to now, and the before
 * window shrinks to match, so a change shipped 2h ago compares 2h vs 2h, not 2h vs 6h.
 */
export function compareWindow(at: string, windowHours: number, now = Date.now()): Window | { error: string } {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return { error: "invalid_timestamp" };
  const span = Math.min(windowHours * HOUR, now - t);
  if (span <= 0) return { error: "timestamp_in_future" };
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    before: { start: iso(t - span), end: iso(t) },
    after: { start: iso(t), end: iso(t + span) },
    hours: Math.round((span / HOUR) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------------------------
// Sentry: error delta

type SentryIssue = { id: string; shortId: string; title: string; count: string; userCount: number; firstSeen: string; substatus?: string; permalink: string };

export type SentryDelta = {
  org: string;
  project: string;
  window: Window;
  before: { events: number; issues: number };
  after: { events: number; issues: number };
  newIssues: { shortId: string; title: string; events: number; users: number; firstSeen: string; permalink: string }[];
  regressedIssues: { shortId: string; title: string; events: number; permalink: string }[];
  worsenedIssues: { shortId: string; title: string; before: number; after: number; permalink: string }[];
};

async function sentryIssuesIn(access: Extract<SentryAccess, { ok: true }>, start: string, end: string, signal?: AbortSignal) {
  // The org issues endpoint honors start/end (the project endpoint ignores them), and counts
  // events inside the window. The demo token has no org:read, so events-stats isn't an option.
  const params = new URLSearchParams({ query: `project:${access.project}`, start, end, sort: "freq", limit: "100" });
  const res = await fetch(`${SENTRY_API}/organizations/${access.org}/issues/?${params}`, {
    headers: { authorization: `Bearer ${access.token}` },
    signal,
  });
  if (!res.ok) throw new Error(`Sentry API ${res.status}`);
  return (await res.json()) as SentryIssue[];
}

export async function sentryErrorDelta(
  access: Extract<SentryAccess, { ok: true }>,
  window: Window,
  signal?: AbortSignal,
): Promise<SentryDelta> {
  if (!access.project) throw new Error("no_sentry_project");
  const [before, after] = await Promise.all([
    sentryIssuesIn(access, window.before.start, window.before.end, signal),
    sentryIssuesIn(access, window.after.start, window.after.end, signal),
  ]);
  const events = (issues: SentryIssue[]) => issues.reduce((sum, i) => sum + Number(i.count), 0);
  const beforeById = new Map(before.map((i) => [i.id, Number(i.count)]));
  const anchor = Date.parse(window.after.start);
  return {
    org: access.org,
    project: access.project,
    window,
    before: { events: events(before), issues: before.length },
    after: { events: events(after), issues: after.length },
    newIssues: after
      .filter((i) => Date.parse(i.firstSeen) >= anchor)
      .slice(0, 5)
      .map((i) => ({ shortId: i.shortId, title: i.title, events: Number(i.count), users: i.userCount, firstSeen: i.firstSeen, permalink: i.permalink })),
    regressedIssues: after
      .filter((i) => i.substatus === "regressed")
      .slice(0, 5)
      .map((i) => ({ shortId: i.shortId, title: i.title, events: Number(i.count), permalink: i.permalink })),
    worsenedIssues: after
      .filter((i) => beforeById.has(i.id) && Number(i.count) >= Math.max(5, 2 * beforeById.get(i.id)!))
      .slice(0, 5)
      .map((i) => ({ shortId: i.shortId, title: i.title, before: beforeById.get(i.id)!, after: Number(i.count), permalink: i.permalink })),
  };
}

// ---------------------------------------------------------------------------------------------
// PostHog: usage delta

export type PosthogAccess =
  | { ok: true; host: string; projectId: string; token: string }
  | { ok: false; error: string; message: string };

const POSTHOG_HOSTS = new Set(["https://us.posthog.com", "https://eu.posthog.com"]);

export async function posthogAccessFor(resolved: ResolvedWorkspace): Promise<PosthogAccess> {
  const connection = findConnection(resolved, "posthog");
  const config = (connection?.config ?? {}) as { projectId?: unknown; host?: unknown };
  const host = typeof config.host === "string" ? config.host.replace(/\/$/, "") : "https://us.posthog.com";
  const projectId = typeof config.projectId === "string" || typeof config.projectId === "number" ? String(config.projectId) : "";
  if (!connection || !/^\d+$/.test(projectId) || !POSTHOG_HOSTS.has(host)) {
    return { ok: false, error: "no_posthog_connection", message: "This workspace has no PostHog connection yet. Ask the team to connect PostHog in Roary's setup." };
  }
  let token: string | null = null;
  try {
    token = await credentialFor(resolved, connection, process.env.POSTHOG_API_KEY);
  } catch {
    return { ok: false, error: "posthog_token_unreadable", message: "This workspace's PostHog key couldn't be read. Ask the team to reconnect PostHog." };
  }
  if (!token) return { ok: false, error: "posthog_token_missing", message: "This workspace's PostHog connection has no key yet." };
  return { ok: true, host, projectId, token };
}

export type EventDelta = { event: string; before: number; after: number; usersBefore: number; usersAfter: number };
export type PosthogDelta = {
  projectId: string;
  window: Window;
  totals: { before: number; after: number };
  events: EventDelta[];
};

const EVENT_NAME = /^[\w$.:\- ]{1,100}$/;

/**
 * Event counts (and distinct users) in the before/after windows. With `events`, only those; without,
 * the busiest events plus any failure-looking ones (`*_failed`, `*error*`, ...).
 */
export async function posthogEventDelta(
  access: Extract<PosthogAccess, { ok: true }>,
  window: Window,
  events: string[] | undefined,
  signal?: AbortSignal,
): Promise<PosthogDelta> {
  const wanted = events?.filter((e) => EVENT_NAME.test(e));
  const hogql = (t: string) => t.replace("T", " ").replace("Z", "");
  const res = await fetch(`${access.host}/api/projects/${access.projectId}/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        // Bounded by timestamp on both sides (unbounded scans time out); values are parameters.
        query: `select event, countIf(timestamp < toDateTime({t}, 'UTC')) as b, countIf(timestamp >= toDateTime({t}, 'UTC')) as a,
          uniqIf(distinct_id, timestamp < toDateTime({t}, 'UTC')) as ub, uniqIf(distinct_id, timestamp >= toDateTime({t}, 'UTC')) as ua
          from events where timestamp >= toDateTime({s}, 'UTC') and timestamp < toDateTime({e}, 'UTC')
          group by event order by a + b desc limit 200`,
        values: { t: hogql(window.after.start), s: hogql(window.before.start), e: hogql(window.after.end) },
      },
    }),
  });
  if (!res.ok) throw new Error(`PostHog API ${res.status}`);
  const rows = ((await res.json()) as { results: [string, number, number, number, number][] }).results ?? [];
  const all = rows.map(([event, before, after, usersBefore, usersAfter]) => ({ event, before, after, usersBefore, usersAfter }));
  const totals = { before: all.reduce((s, r) => s + r.before, 0), after: all.reduce((s, r) => s + r.after, 0) };
  let picked: EventDelta[];
  if (wanted?.length) {
    picked = wanted.map((event) => all.find((r) => r.event === event) ?? { event, before: 0, after: 0, usersBefore: 0, usersAfter: 0 });
  } else {
    const failures = all.filter((r) => FAILURE_EVENT.test(r.event));
    const busiest = all.filter((r) => !FAILURE_EVENT.test(r.event) && !r.event.startsWith("$")).slice(0, 6);
    picked = [...busiest, ...failures.slice(0, 4)];
  }
  return { projectId: access.projectId, window, totals, events: picked };
}

// ---------------------------------------------------------------------------------------------
// Assessment

export type Verdict = "healthy" | "watch" | "bad" | "too_early";
export type Assessment = { verdict: Verdict; confidence: "high" | "medium" | "low"; reasons: string[] };

const VERDICT_LABEL: Record<Verdict, string> = {
  healthy: "Healthy",
  watch: "Watch this",
  bad: "Looks bad, consider rollback",
  too_early: "Too early to tell",
};

/**
 * A first-pass verdict from the numbers. The model (and the schedule) still report "what I saw"
 * separately; this only decides the headline and how sure to be.
 */
export function assessChange(input: {
  window: Window | null;
  sentry: SentryDelta | null;
  posthog: PosthogDelta | null;
  overlapping: number;
}): Assessment {
  const { sentry, posthog } = input;
  const reasons: string[] = [];
  if (!input.window || input.window.hours * HOUR < MIN_SPAN_MS) {
    return { verdict: "too_early", confidence: "low", reasons: ["less than 30 minutes of data after the change"] };
  }
  const noBaseline = posthog ? posthog.totals.before === 0 : false;
  if (noBaseline) reasons.push("no traffic before the change, so there's no baseline");

  const newIssueEvents = sentry?.newIssues.reduce((s, i) => s + i.events, 0) ?? 0;
  const errorSpike = sentry ? sentry.after.events >= Math.max(20, 3 * sentry.before.events) && sentry.after.events > sentry.before.events : false;
  const errorRise = sentry ? sentry.after.events > Math.max(5, 1.5 * sentry.before.events) : false;
  const failures = posthog?.events.filter((e) => FAILURE_EVENT.test(e.event)) ?? [];
  const failureSpike = failures.some((e) => e.after >= Math.max(10, 2 * e.before) && e.after > e.before);
  const usageDrop = posthog?.events.some((e) => !FAILURE_EVENT.test(e.event) && e.before >= 20 && e.after < 0.7 * e.before) ?? false;

  if (sentry?.newIssues.length) reasons.push(`${sentry.newIssues.length} new Sentry issue(s), ${newIssueEvents} events`);
  if (sentry?.regressedIssues.length) reasons.push(`${sentry.regressedIssues.length} regressed issue(s)`);
  if (failureSpike) reasons.push(`failure events up: ${failures.map((e) => `${e.event} ${e.before} → ${e.after}`).join(", ")}`);
  if (usageDrop) reasons.push("a key usage event dropped by more than 30%");
  if (input.overlapping) reasons.push(`${input.overlapping} other change(s) shipped within the same window, so attribution is shared`);

  let verdict: Verdict = "healthy";
  if ((newIssueEvents >= 10 && failureSpike) || newIssueEvents >= 50 || (errorSpike && !noBaseline && failureSpike)) verdict = "bad";
  else if (sentry?.newIssues.length || sentry?.regressedIssues.length || sentry?.worsenedIssues.length || errorRise || failureSpike || usageDrop) verdict = "watch";

  const bothSources = Boolean(sentry && posthog);
  const signalsAgree = verdict === "bad" ? newIssueEvents > 0 && failureSpike : true;
  let confidence: Assessment["confidence"] = "medium";
  if (!bothSources || input.overlapping > 1 || (verdict === "healthy" && noBaseline)) confidence = "low";
  else if (bothSources && signalsAgree && input.window.hours >= 2 && !noBaseline && !input.overlapping) confidence = "high";
  if (!sentry) reasons.push("no Sentry data");
  if (!posthog) reasons.push("no PostHog data");
  return { verdict, confidence, reasons };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** One line for the `launches.health_summary` column and the desk feed. */
export function healthLine(a: Assessment, sentry: SentryDelta | null, posthog: PosthogDelta | null, window: Window | null): string {
  const parts = [`${VERDICT_LABEL[a.verdict]} (${a.confidence} confidence).`];
  if (sentry) {
    const top = sentry.newIssues[0];
    parts.push(`Errors ${sentry.before.events} → ${sentry.after.events}${top ? ` (new: ${top.shortId} ${clip(top.title, 70)})` : ""}.`);
  }
  if (posthog) {
    const shown = [...posthog.events.filter((e) => FAILURE_EVENT.test(e.event)), ...posthog.events.filter((e) => !FAILURE_EVENT.test(e.event))].slice(0, 2);
    if (shown.length) parts.push(`${shown.map((e) => `${e.event} ${e.before} → ${e.after}`).join(", ")}.`);
  }
  if (window) parts.push(`${window.hours}h before vs after.`);
  return parts.join(" ").slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// Persistence (launches, workspace-scoped). No unique key on (workspace, repo, pr), so upsert by
// hand inside a transaction holding an advisory lock on that key; steps can retry.

export async function saveLaunchReview(
  workspaceId: number,
  row: { repo: string; prNumber: number | null; sha?: string | null; title: string; deploymentUrl?: string | null; healthSummary: string },
) {
  // Direct pushes have no PR: pr_number 0 and the short sha leads the title, which is the key.
  const prNumber = row.prNumber ?? 0;
  const shortSha = row.sha?.slice(0, 7);
  if (!prNumber && !shortSha) throw new Error("sha_required_without_pr");
  const title = prNumber ? row.title : `${shortSha} ${row.title.replace(new RegExp(`^${shortSha}\\s+`), "")}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`roary-launch:${workspaceId}:${row.repo}:${prNumber || shortSha}`}))`);
    const key = and(
      eq(schema.launches.workspaceId, workspaceId),
      eq(schema.launches.repo, row.repo),
      eq(schema.launches.prNumber, prNumber),
      ...(prNumber ? [] : [like(schema.launches.title, `${shortSha} %`)]),
    );
    const fields = { healthSummary: row.healthSummary, ...(row.deploymentUrl ? { deploymentUrl: row.deploymentUrl } : {}) };
    const [updated] = await tx.update(schema.launches).set(fields).where(key).returning();
    if (updated) return updated;
    const [inserted] = await tx
      .insert(schema.launches)
      .values({ workspaceId, repo: row.repo, prNumber, title, ...fields })
      .returning();
    return inserted!;
  });
}

// ---------------------------------------------------------------------------------------------
// Whole-workspace review (the daily schedule)

export type ChangeReview = { change: ShippedChange; assessment: Assessment; summary: string; launchId: number };

export async function reviewWorkspace(
  resolved: ResolvedWorkspace,
  access: { github: GithubAccess; sentry: SentryAccess; posthog: PosthogAccess },
  opts: { sinceHours?: number; windowHours?: number; now?: number } = {},
): Promise<{ skipped?: string; reviews: ChangeReview[] }> {
  const { github, sentry, posthog } = access;
  if (!github.ok) return { skipped: github.error, reviews: [] };
  const now = opts.now ?? Date.now();
  const reviews: ChangeReview[] = [];
  for (const repo of github.repos.slice(0, 3)) {
    const token = await github.token(repo);
    const { changes } = await listShippedChanges(token, repo, opts.sinceHours ?? 24, { now });
    // A direct push without its own production deploy rides along with the next deploy; only
    // review merged PRs and deployed pushes.
    const reviewable = changes.filter((c) => c.kind === "pr" || c.deployedAt).slice(0, 10);
    for (const change of reviewable) {
      const window = compareWindow(change.anchor, opts.windowHours ?? 6, now);
      const w = "error" in window ? null : window;
      const [s, p] = await Promise.all([
        w && sentry.ok && sentry.project ? sentryErrorDelta(sentry, w).catch(() => null) : null,
        w && posthog.ok ? posthogEventDelta(posthog, w, undefined).catch(() => null) : null,
      ]);
      const overlapping = w
        ? reviewable.filter((o) => o !== change && o.anchor >= w.before.start && o.anchor <= w.after.end).length
        : 0;
      const assessment = assessChange({ window: w, sentry: s, posthog: p, overlapping });
      const summary = healthLine(assessment, s, p, w);
      const saved = await saveLaunchReview(resolved.workspace.id, {
        repo,
        prNumber: change.prNumber,
        sha: change.sha,
        title: change.title,
        deploymentUrl: change.deploymentUrl,
        healthSummary: summary,
      });
      reviews.push({ change, assessment, summary, launchId: saved.id });
    }
  }
  return { reviews };
}
