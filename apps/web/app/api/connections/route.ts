import { hasEncryptionKey } from "../../../../../agent/lib/crypto";
import { sentryAppCredentials } from "../../../../../agent/lib/sentry-app";
import { githubConnectEnabled } from "@/lib/connections/github-user";
import { getConnectionStore } from "@/lib/connections/store";
import { PROVIDERS, type PublicConnection, toPublic } from "@/lib/connections/types";
import { getUserWorkspace } from "@/lib/connections/workspace";

export const dynamic = "force-dynamic";

/** The "Install Roary in Sentry" button: SENTRY_PUBLIC_INTEGRATION_ENABLED=1 plus the app's env. */
const sentryAppReady = () => sentryAppCredentials() !== null;

// The signed-in user's stack, for the cards. Never returns secrets. Guests get 401 (they use
// the demo shop, which can't be reconfigured); the body still says so for the UI.
export async function GET() {
  const workspace = await getUserWorkspace().catch(() => undefined);
  if (workspace === undefined) return Response.json({ error: "Couldn't load your workspace right now." }, { status: 503 });
  if (!workspace) {
    return Response.json(
      { signedIn: false, githubEnabled: githubConnectEnabled(), sentryAppEnabled: sentryAppReady(), error: "Sign in to connect your own stack." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const store = await getConnectionStore();
    const rows = await store.list(workspace.id);
    const connections: Record<string, PublicConnection | null> = Object.fromEntries(PROVIDERS.map((p) => [p, null]));
    for (const row of rows) connections[row.provider] = toPublic(row);
    return Response.json(
      { signedIn: true, store: store.kind, encryptionReady: hasEncryptionKey(), githubEnabled: githubConnectEnabled(), sentryAppEnabled: sentryAppReady(), connections },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("listing connections failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't load your connections right now." }, { status: 503 });
  }
}
