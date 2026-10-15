import { testConnection } from "@/lib/connections/service";
import { isProvider } from "@/lib/connections/types";
import { getUserWorkspace } from "@/lib/connections/workspace";

type Context = { params: Promise<{ provider: string }> };

// The card's Test button: re-validates with the stored credential, server side.
export async function POST(_request: Request, context: Context) {
  const { provider } = await context.params;
  if (!isProvider(provider)) return Response.json({ error: "Unknown provider." }, { status: 404 });
  const workspace = await getUserWorkspace();
  if (!workspace) return Response.json({ error: "Sign in to test your own stack." }, { status: 401 });
  try {
    const result = await testConnection(workspace.id, provider);
    if (!result.ok) return Response.json({ ok: false, error: result.message, code: result.code }, { status: 200 });
    return Response.json({ ok: true, connection: result.connection, checkedVia: result.checkedVia });
  } catch (error) {
    console.error(`testing ${provider} failed`, error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't run the test right now." }, { status: 503 });
  }
}
