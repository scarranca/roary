import { defineTool } from "eve/tools";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, toJson } from "../lib/db";
import { workspaceForTurn } from "../lib/workspace-context";

export default defineTool({
  description:
    "Save or update what you know about a Sentry error you are triaging. Call this whenever your understanding of an incident changes (new diagnosis, impact numbers, suspect commit, or a fix PR), so the team has a running record.",
  inputSchema: z.object({
    sentryIssueId: z.string().describe("Sentry issue id, e.g. 'ROARY-12'"),
    title: z.string().describe("Short human-readable title of the error"),
    status: z
      .enum(["investigating", "diagnosed", "fix_proposed", "resolved"])
      .describe("Where the incident is in the triage flow"),
    usersAffected: z.number().int().optional().describe("Distinct users affected, from PostHog/Sentry"),
    diagnosis: z.string().optional().describe("Plain-English root cause, separating what you saw from what you think"),
    suspectCommit: z.string().optional().describe("SHA of the commit that likely introduced the error"),
    prUrl: z.string().url().optional().describe("URL of the fix PR, if one was opened"),
  }),
  async execute(input, ctx) {
    const { workspace } = await workspaceForTurn(ctx);
    const { sentryIssueId, ...fields } = input;
    const [row] = await db
      .insert(schema.incidents)
      .values({ ...input, workspaceId: workspace.id })
      .onConflictDoUpdate({
        target: schema.incidents.sentryIssueId,
        set: { ...fields, updatedAt: sql`now()` },
        // sentry_issue_id is still globally unique: never overwrite another workspace's row.
        setWhere: eq(schema.incidents.workspaceId, workspace.id),
      })
      .returning();
    if (!row) return { error: "incident_belongs_to_another_workspace", sentryIssueId };
    return toJson(row);
  },
});
