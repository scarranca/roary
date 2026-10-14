import { desc } from "drizzle-orm";
import { db, schema } from "../../../../../agent/lib/db";

// The desk polls this every few seconds; always read fresh rows.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
        .orderBy(desc(schema.launches.createdAt))
        .limit(10),
    ]);
    return Response.json({ incidents, launches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Log the error name only: pg messages can echo connection details.
    console.error("feed query failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "The desk can't reach Roary's records right now." }, { status: 503 });
  }
}
