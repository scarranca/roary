import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../../../../agent/lib/db";
import { NEON_AUTH_AUTHENTICATOR, resolveWorkspace } from "../../../../../agent/lib/workspace";
import { getSessionUserId } from "@/lib/auth/server";

// The desk polls this every few seconds; always read fresh rows.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Signed-in people see their own workspace; guests see the demo shop.
    const userId = await getSessionUserId();
    const { workspace, connections } = await resolveWorkspace(
      userId ? { authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: userId } : null,
    );
    const [incidents, launches] = await Promise.all([
      db
        .select({
          id: schema.incidents.id,
          sentryIssueId: schema.incidents.sentryIssueId,
          title: schema.incidents.title,
          status: schema.incidents.status,
          usersAffected: schema.incidents.usersAffected,
          suspectCommit: schema.incidents.suspectCommit,
          prUrl: schema.incidents.prUrl,
          updatedAt: schema.incidents.updatedAt,
        })
        .from(schema.incidents)
        .where(eq(schema.incidents.workspaceId, workspace.id))
        .orderBy(desc(schema.incidents.updatedAt))
        .limit(20),
      db
        .select({
          id: schema.launches.id,
          repo: schema.launches.repo,
          prNumber: schema.launches.prNumber,
          title: schema.launches.title,
          videoUrl: schema.launches.videoUrl,
          healthSummary: schema.launches.healthSummary,
          createdAt: schema.launches.createdAt,
        })
        .from(schema.launches)
        .where(eq(schema.launches.workspaceId, workspace.id))
        .orderBy(desc(schema.launches.createdAt))
        .limit(10),
    ]);
    // No ids or config: just enough for the desk to show "Connect your stack" to an empty workspace.
    const connected = connections.filter((c) => c.status === "connected").map((c) => c.provider);
    return Response.json(
      { incidents, launches, workspace: { signedIn: !workspace.isDemo, isDemo: workspace.isDemo, connected } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Log the error name only: pg messages can echo connection details.
    console.error("feed query failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "The desk can't reach Roary's records right now." }, { status: 503 });
  }
}
