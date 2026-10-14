import { generateText, Output } from "ai";
import { z } from "zod";
import { characterSchema, sanitizeCharacter } from "@/lib/roary-character";

// Turns an uploaded picture into a toy-kit character. Only the kit's fields come
// back, so whatever the picture shows, the figure stays buildable and animatable.

export const maxDuration = 30;

// The client shrinks pictures to ~1024px JPEG first; this keeps the request well
// under Vercel's 4.5 MB body limit even after base64.
const MAX_BYTES = 2.5 * 1024 * 1024;

// Public endpoint that spends model credits: a small per-IP budget per instance.
// Good enough for a demo; a shared store (KV/Upstash) is the real fix (#22).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const recent = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > MAX_PER_WINDOW;
}

const requestSchema = z.object({
  image: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,/)
    .refine((value) => value.length * 0.75 <= MAX_BYTES, "Image too large"),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return Response.json(
      { error: "That's a lot of pictures in a row. Wait a minute, then try again." },
      { status: 429 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Send a PNG, JPEG, WebP or GIF picture of 2.5 MB or less." },
      { status: 400 },
    );
  }

  try {
    const { output } = await generateText({
      model: "anthropic/claude-sonnet-5",
      abortSignal: request.signal,
      maxOutputTokens: 800,
      output: Output.object({ schema: characterSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "You design collectible vinyl toy figures. Turn the subject of this picture into a toy using only the parts in the schema.",
                "Pick the parts that make it recognizable at a glance: silhouette of the head, ears, any mane or hair, the snout, and its signature colors.",
                "If the picture is a logo, an object or a person, invent a friendly character that keeps its shapes and colors.",
                "Use the picture's real colors as hex values. Keep eyes dark unless the subject clearly has a visor or glowing eyes.",
              ].join(" "),
            },
            { type: "file", mediaType: "image", data: parsed.data.image },
          ],
        },
      ],
    });
    return Response.json({ character: sanitizeCharacter(output) });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("character generation failed", error);
    return Response.json(
      { error: "Roary couldn't read that picture. Try another one, or pick a character instead." },
      { status: 502 },
    );
  }
}
