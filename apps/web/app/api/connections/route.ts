import { hasEncryptionKey } from "@/lib/connections/crypto";
import { getConnectionStore } from "@/lib/connections/store";
import { PROVIDERS, type PublicConnection, toPublic } from "@/lib/connections/types";
import { getCurrentWorkspace } from "@/lib/connections/workspace";

// The current workspace's stack, for the cards. Never returns secrets.
export async function GET() {
  const workspace = await getCurrentWorkspace();
  if (workspace.kind === "demo") {
    return Response.json({ signedIn: false, connections: Object.fromEntries(PROVIDERS.map((p) => [p, null])) });
  }
  try {
    const store = await getConnectionStore();
    const rows = await store.list(workspace.id);
    const connections: Record<string, PublicConnection | null> = Object.fromEntries(PROVIDERS.map((p) => [p, null]));
    for (const row of rows) connections[row.provider] = toPublic(row);
    return Response.json({ signedIn: true, store: store.kind, encryptionReady: hasEncryptionKey(), connections });
  } catch (error) {
    console.error("listing connections failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Couldn't load your connections right now." }, { status: 503 });
  }
}
