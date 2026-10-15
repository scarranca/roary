import { z } from "zod";
import { db, schema } from "../../../../../agent/lib/db";
import { NEON_AUTH_AUTHENTICATOR, resolveWorkspace } from "../../../../../agent/lib/workspace";
import { getSessionUserId } from "@/lib/auth/server";
import { characterSchema } from "@/lib/roary-character";

// Saves a Roary hired in the fitting room (#15). Images stay in the browser for
// now (logo and snapshot are data URLs); avatarUrl is filled once they go to Blob.

const score = z.number().int().min(0).max(100);

const hireSchema = z.object({
  name: z.string().trim().min(1).max(40),
  look: z.object({
    character: characterSchema,
    outfit: z.enum(["crew", "hoodie", "tee"]),
    outfitColor: z.string().max(9),
    accentColor: z.string().max(9),
    headwear: z.enum(["none", "cap", "beanie", "headphones"]),
    logoPatch: z.string().max(9).optional(),
  }),
  personality: z.object({ playful: score, detailed: score, proactive: score, emoji: score }),
  jobs: z.object({ triage: z.boolean(), fixPrs: z.boolean(), launchReview: z.boolean(), launchVideo: z.boolean() }),
  autonomy: z.enum(["suggest", "open_prs"]),
});

export async function POST(request: Request) {
  const parsed = hireSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "That hire is missing something. Try signing again." }, { status: 400 });
  }
  const { name, look, personality, jobs, autonomy } = parsed.data;
  // A signed-in hire belongs to the session's user; the body never carries an id.
  const userId = await getSessionUserId();
  try {
    const { workspace } = await resolveWorkspace(
      userId ? { authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: userId } : null,
    );
    const [row] = await db
      .insert(schema.roaryProfiles)
      .values({ name, species: look.character.species, look, personality, jobs, autonomy, userId, workspaceId: workspace.id })
      .returning({ id: schema.roaryProfiles.id });
    return Response.json({ id: row.id }, { status: 201 });
  } catch (error) {
    console.error("saving profile failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't save the hire right now." }, { status: 503 });
  }
}
