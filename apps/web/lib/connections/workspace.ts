import { createHash } from "node:crypto";
import { getSessionUserId } from "@/lib/auth/server";

// STUB for santiago/connect-foundation, which owns users → workspaces. Replace the body
// of getCurrentWorkspace() with its lookup; callers only rely on this shape.

export type Workspace =
  | { kind: "user"; id: number; userId: string }
  /** Guests share the demo shop's workspace, which nobody may reconfigure. */
  | { kind: "demo"; id: number };

export const DEMO_WORKSPACE_ID = 0;

/** Stable positive int from a user id until real workspace rows exist. */
function stubWorkspaceId(userId: string): number {
  return (createHash("sha256").update(userId).digest().readUInt32BE(0) & 0x7fffffff) || 1;
}

export async function getCurrentWorkspace(): Promise<Workspace> {
  // Local testing without Neon Auth: never honored in production builds.
  const devId = process.env.NODE_ENV !== "production" ? Number(process.env.CONNECTIONS_DEV_WORKSPACE_ID) : Number.NaN;
  if (Number.isInteger(devId) && devId > 0) return { kind: "user", id: devId, userId: `dev-${devId}` };

  const userId = await getSessionUserId();
  if (!userId) return { kind: "demo", id: DEMO_WORKSPACE_ID };
  return { kind: "user", id: stubWorkspaceId(userId), userId };
}
