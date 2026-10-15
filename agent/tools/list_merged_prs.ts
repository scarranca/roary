import { defineTool } from "eve/tools";
import { z } from "zod";
import { githubAccess } from "../lib/github-access";
import { listShippedChanges } from "../lib/launch-review";

// github__listPullRequests (extension) doesn't return merge times, merge SHAs or deployments, so
// launch reviews use this instead. Read-only, and limited to the workspace's connected repos.
export default defineTool({
  description:
    "List what shipped to a repo recently: PRs merged and commits pushed straight to the default branch in the last N hours, each with its production deployment time when GitHub knows one. Use this first in a launch review ('what shipped?', 'review launches'). Each change has an `anchor` timestamp (the production deploy, else the merge/commit time): pass it as `at` to sentry_error_delta and posthog_event_delta. If it returns no_github_connection, say the workspace needs GitHub connected.",
  inputSchema: z.object({
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional()
      .describe("owner/name; must be one of the workspace's connected repos. Omit to use all of them"),
    sinceHours: z.number().int().min(1).max(168).default(24).describe("Look back this many hours (default 24)"),
  }),
  async execute({ repo, sinceHours }, ctx) {
    const access = await githubAccess(ctx);
    if (!access.ok) return { error: access.error, message: access.message };
    if (repo && !access.repos.includes(repo)) {
      return { error: "repo_not_connected", message: `${repo} isn't one of this workspace's repos (${access.repos.join(", ")}).` };
    }
    const repos = repo ? [repo] : access.repos.slice(0, 3);
    try {
      const results = await Promise.all(
        repos.map(async (r) => listShippedChanges(await access.token(r), r, sinceHours, { signal: ctx.abortSignal })),
      );
      return { now: new Date().toISOString(), sinceHours, repos: results };
    } catch (error) {
      return { error: "github_failed", message: error instanceof Error ? error.message : "GitHub request failed" };
    }
  },
});
