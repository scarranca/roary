import { z } from "zod";
import { hasEncryptionKey } from "../../../../../../agent/lib/crypto";
import { saveGithubPat, savePosthog, saveSentry } from "@/lib/connections/service";
import { MAX_PAT_REPOS, POSTHOG_HOSTS } from "@/lib/connections/validate";
import { getUserWorkspace } from "@/lib/connections/workspace";

// Paste-a-key connects: validate live, then store encrypted.
// - sentry: token + org + project, optionally the internal integration's client secret (quick
//   connect: its alerts start triage automatically);
// - posthog: personal API key + project + region;
// - github: quick connect with a personal access token + repos (the App install flow,
//   /api/connect/github/install, stays the second option behind GITHUB_CONNECT_ENABLED).

const sentrySchema = z.object({
  token: z.string().trim().min(10).max(512),
  org: z.string().trim().min(1).max(64),
  project: z.string().trim().min(1).max(64),
  clientSecret: z
    .string()
    .trim()
    .max(256)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || v.length >= 16, "too short"),
});

const posthogSchema = z.object({
  apiKey: z.string().trim().min(10).max(512),
  projectId: z.string().trim().min(1).max(12),
  region: z.enum(["us", "eu"]),
});

const githubSchema = z.object({
  token: z.string().trim().min(20).max(255),
  repos: z.union([z.string().trim().min(3).max(4_000), z.array(z.string().trim().min(3).max(200)).min(1).max(MAX_PAT_REPOS)]),
});

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: Context) {
  const { provider } = await context.params;
  if (provider !== "sentry" && provider !== "posthog" && provider !== "github") {
    return Response.json({ error: "Unknown provider." }, { status: 404 });
  }
  const workspace = await getUserWorkspace().catch(() => undefined);
  if (workspace === undefined) return Response.json({ error: "Couldn't load your workspace right now." }, { status: 503 });
  if (!workspace) {
    return Response.json({ error: "Sign in to connect your own stack." }, { status: 401 });
  }
  if (!hasEncryptionKey()) {
    return Response.json({ error: "Connections aren't set up on this server yet." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  try {
    if (provider === "github") {
      const parsed = githubSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Add a token and at least one repo (owner/name)." }, { status: 400 });
      const result = await saveGithubPat(workspace.id, parsed.data);
      if (!result.ok) return Response.json({ error: result.message, code: result.code }, { status: 422 });
      // The webhook secret appears only here (first connect); it is never returned again.
      return Response.json(
        { connection: result.connection, checkedVia: result.checkedVia, webhookSecret: result.webhookSecret ?? null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (provider === "sentry") {
      const parsed = sentrySchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "Add a token, an org and a project (and the full client secret, if you paste one)." }, { status: 400 });
      }
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
