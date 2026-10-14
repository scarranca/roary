import { defineTool } from "eve/tools";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, toJson } from "../lib/db";
import { workspaceForTurn } from "../lib/workspace-context";

export default defineTool({
  description:
    "List incidents Roary has triaged for this workspace, newest first. Use this before starting on a Sentry error (to avoid duplicate work) and when someone asks what's broken or what you've been working on.",
  inputSchema: z.object({
    status: z
      .enum(["investigating", "diagnosed", "fix_proposed", "resolved"])
      .optional()
      .describe("Only return incidents in this status"),
    limit: z.number().int().min(1).max(50).default(10).describe("Max rows to return"),
  }),
  async execute({ status, limit }, ctx) {
    const { workspace } = await workspaceForTurn(ctx);
    const rows = await db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.workspaceId, workspace.id),
          status ? eq(schema.incidents.status, status) : undefined,
        ),
      )
      .orderBy(desc(schema.incidents.createdAt))
      .limit(limit);
    return toJson(rows);
  },
});
