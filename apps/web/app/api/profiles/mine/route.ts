import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../../../../../agent/lib/db";
import { getSessionUserId } from "@/lib/auth/server";

// The signed-in user's hires, newest first. The user id comes from the session only.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Sign in to see your Roarys." }, { status: 401 });
  try {
    const profiles = await db
      .select({
        id: schema.roaryProfiles.id,
        name: schema.roaryProfiles.name,
        species: schema.roaryProfiles.species,
        createdAt: schema.roaryProfiles.createdAt,
      })
      .from(schema.roaryProfiles)
      .where(eq(schema.roaryProfiles.userId, userId))
      .orderBy(desc(schema.roaryProfiles.createdAt))
      .limit(50);
    return Response.json({ profiles });
  } catch (error) {
    console.error("listing profiles failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't load your Roarys right now." }, { status: 503 });
  }
}
