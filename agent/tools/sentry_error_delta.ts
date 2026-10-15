import { defineTool } from "eve/tools";
import { z } from "zod";
import { compareWindow, sentryErrorDelta } from "../lib/launch-review";
import { sentryAccess } from "../lib/sentry-access";

export default defineTool({
  description:
    "Compare Sentry errors before vs after a moment (a deploy or merge) in this workspace's connected Sentry project: error events and issues in equal windows on each side, issues first seen after it (new), regressed issues, and issues whose volume at least doubled. Use it in launch reviews with the `anchor` from list_merged_prs. The after window is clipped to now and the before window shrinks to match.",
  inputSchema: z.object({
    at: z.string().datetime({ offset: true }).describe("ISO timestamp of the deploy/merge, e.g. a change's `anchor` from list_merged_prs"),
    windowHours: z.number().min(0.5).max(24).default(6).describe("Hours on each side of `at` (default 6)"),
  }),
  async execute({ at, windowHours }, ctx) {
    const access = await sentryAccess(ctx);
    if (!access.ok) return { error: access.error, message: access.message };
    if (!access.project) return { error: "no_sentry_project", message: "The workspace's Sentry connection has no project selected yet." };
    const window = compareWindow(at, windowHours);
    if ("error" in window) return window;
    try {
      return await sentryErrorDelta(access, window, ctx.abortSignal);
    } catch (error) {
      return { error: "sentry_failed", message: error instanceof Error ? error.message : "Sentry request failed" };
    }
  },
});
