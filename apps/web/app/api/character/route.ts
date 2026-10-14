import { generateText, Output } from "ai";
import { z } from "zod";
import { characterSchema, sanitizeCharacter } from "@/lib/roary-character";

// Turns an uploaded picture into a toy-kit character. Only the kit's fields come
// back, so whatever the picture shows, the figure stays buildable and animatable.
const MAX_BYTES = 4 * 1024 * 1024;

const requestSchema = z.object({
  image: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,/)
    .refine((value) => value.length * 0.75 <= MAX_BYTES, "Image must be 4 MB or smaller"),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Send a PNG, JPEG, WebP or GIF picture of 4 MB or less." },
      { status: 400 },
    );
  }

  try {
    const { output } = await generateText({
      model: "anthropic/claude-sonnet-5",
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
    console.error("character generation failed", error);
    return Response.json(
      { error: "Roary couldn't read that picture. Try another one, or pick a character instead." },
      { status: 502 },
    );
  }
}
