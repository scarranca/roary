import { defineTool } from "eve/tools";
import { z } from "zod";
import { toJson } from "../lib/db";
import { saveLaunchReview } from "../lib/launch-review";
import { workspaceForTurn } from "../lib/workspace-context";

export default defineTool({
  description:
    "Record the launch review of one shipped change (a merged PR, or a direct push with its sha) for this workspace, so it shows on the team's desk. Call it once per reviewed change after you've compared errors and usage, before posting the report. Calling it again for the same change updates the summary.",
  inputSchema: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe("owner/name"),
    prNumber: z.number().int().positive().optional().describe("Merged PR number; omit for a direct push"),
    sha: z.string().regex(/^[0-9a-f]{7,40}$/).optional().describe("Commit sha; required for a direct push"),
    title: z.string().min(1).max(160).describe("What shipped, human readable (PR title or commit subject)"),
    deploymentUrl: z.string().url().optional().describe("Production deployment URL, if known"),
    healthSummary: z
      .string()
      .min(1)
      .max(400)
      .describe(
        "One line: verdict + confidence + the key numbers, e.g. 'Looks bad, consider rollback (medium confidence). Errors 0 → 50 (new JAVASCRIPT-NEXTJS-K4-1), checkout_failed 0 → 49.'",
      ),
  }),
  async execute(input, ctx) {
    if (!input.prNumber && !input.sha) return { error: "sha_required", message: "Pass the commit sha for a direct push." };
    const { workspace } = await workspaceForTurn(ctx);
    const row = await saveLaunchReview(workspace.id, { ...input, prNumber: input.prNumber ?? null });
    return toJson({ id: row.id, repo: row.repo, prNumber: row.prNumber, title: row.title, healthSummary: row.healthSummary });
  },
});
