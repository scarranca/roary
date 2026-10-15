import { hasEncryptionKey } from "../../../../../../../agent/lib/crypto";
import { rotateGithubWebhookSecret } from "@/lib/connections/service";
import { getUserWorkspace } from "@/lib/connections/workspace";

type Context = { params: Promise<{ provider: string }> };

// "New secret" on the GitHub card (token-connected workspaces): a fresh webhook secret, shown
// once. Paste it into the repo's webhook settings; the old one stops working right away.
// Sentry's client secret is Sentry's to rotate (paste the new one with "Replace key").
export async function POST(_request: Request, context: Context) {
  const { provider } = await context.params;
  if (provider !== "github") return Response.json({ error: "Unknown provider." }, { status: 404 });
  const workspace = await getUserWorkspace().catch(() => undefined);
  if (workspace === undefined) return Response.json({ error: "Couldn't load your workspace right now." }, { status: 503 });
  if (!workspace) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!hasEncryptionKey()) return Response.json({ error: "Connections aren't set up on this server yet." }, { status: 503 });
  try {
    const result = await rotateGithubWebhookSecret(workspace.id);
    if (!result.ok) return Response.json({ error: result.message }, { status: 409 });
    return Response.json({ webhookSecret: result.webhookSecret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("rotating the github webhook secret failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't make a new secret right now." }, { status: 503 });
  }
}
