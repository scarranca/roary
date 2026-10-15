import { z } from "zod";
import { hasEncryptionKey } from "../../../../../../agent/lib/crypto";
import { savePosthog, saveSentry } from "@/lib/connections/service";
import { POSTHOG_HOSTS } from "@/lib/connections/validate";
import { getUserWorkspace } from "@/lib/connections/workspace";

// Paste-a-key connects (Sentry, PostHog): validate live, then store encrypted.
// GitHub connects through the App install flow (/api/connect/github/install) instead.

const sentrySchema = z.object({
  token: z.string().trim().min(10).max(512),
  org: z.string().trim().min(1).max(64),
  project: z.string().trim().min(1).max(64),
});

const posthogSchema = z.object({
  apiKey: z.string().trim().min(10).max(512),
  projectId: z.string().trim().min(1).max(12),
  region: z.enum(["us", "eu"]),
});

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: Context) {
  const { provider } = await context.params;
  if (provider !== "sentry" && provider !== "posthog") {
    return Response.json({ error: "Unknown provider." }, { status: 404 });
  }
  const workspace = await getUserWorkspace();
  if (!workspace) {
    return Response.json({ error: "Sign in to connect your own stack." }, { status: 401 });
  }
  if (!hasEncryptionKey()) {
    return Response.json({ error: "Connections aren't set up on this server yet." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  try {
    if (provider === "sentry") {
      const parsed = sentrySchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Add a token, an org and a project." }, { status: 400 });
      return reply(await saveSentry(workspace.id, parsed.data));
    }
    const parsed = posthogSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Add a key, a project id and a region." }, { status: 400 });
    const { apiKey, projectId, region } = parsed.data;
    return reply(await savePosthog(workspace.id, { apiKey, projectId, host: POSTHOG_HOSTS[region] }));
  } catch (error) {
    console.error(`saving ${provider} connection failed`, error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't save that connection right now." }, { status: 503 });
  }
}

function reply(result: Awaited<ReturnType<typeof saveSentry>>) {
  if (!result.ok) return Response.json({ error: result.message, code: result.code }, { status: 422 });
  return Response.json({ connection: result.connection, checkedVia: result.checkedVia });
}
