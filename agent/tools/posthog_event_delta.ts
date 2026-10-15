import { defineTool } from "eve/tools";
import { z } from "zod";
import { compareWindow, posthogAccessFor, posthogEventDelta } from "../lib/launch-review";
import { workspaceForTurn } from "../lib/workspace-context";

export default defineTool({
  description:
    "Compare PostHog event counts (and distinct users) before vs after a moment (a deploy or merge) in this workspace's connected PostHog project, using equal windows on each side. Pass the events that matter for the change (e.g. checkout_completed, checkout_failed); omit `events` to get the busiest events plus any failure-looking ones. Also returns total events per window, which tells you whether there was any traffic before (a baseline). Use it in launch reviews with the `anchor` from list_merged_prs.",
  inputSchema: z.object({
    at: z.string().datetime({ offset: true }).describe("ISO timestamp of the deploy/merge, e.g. a change's `anchor` from list_merged_prs"),
    windowHours: z.number().min(0.5).max(24).default(6).describe("Hours on each side of `at` (default 6)"),
    events: z
      .array(z.string().regex(/^[\w$.:\- ]{1,100}$/))
      .max(10)
      .optional()
      .describe("Event names to compare, e.g. ['checkout_completed', 'checkout_failed']. Omit for the busiest events + failures"),
  }),
  async execute({ at, windowHours, events }, ctx) {
    const access = await posthogAccessFor(await workspaceForTurn(ctx));
    if (!access.ok) return { error: access.error, message: access.message };
    const window = compareWindow(at, windowHours);
    if ("error" in window) return window;
    try {
      return await posthogEventDelta(access, window, events, ctx.abortSignal);
    } catch (error) {
      return { error: "posthog_failed", message: error instanceof Error ? error.message : "PostHog request failed" };
    }
  },
});
