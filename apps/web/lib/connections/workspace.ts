import { getSessionUserId } from "@/lib/auth/server";

// The web app's view of the caller's workspace, from the same resolver the agent uses
// (agent/lib/workspace.ts → resolveWorkspace): a signed-in Neon Auth user gets their own
// workspace (created on first touch), a guest gets the shared demo workspace, which nobody
// may reconfigure from the web.

export type Workspace =
  | { kind: "user"; id: number; userId: string }
  | { kind: "demo"; id: number };

/** For a signed-in caller only; guests get null without touching the database. */
export async function getUserWorkspace(): Promise<Extract<Workspace, { kind: "user" }> | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const { NEON_AUTH_AUTHENTICATOR, resolveWorkspace } = await import("../../../../agent/lib/workspace");
  const { workspace } = await resolveWorkspace({ authenticator: NEON_AUTH_AUTHENTICATOR, principalType: "user", principalId: userId });
  return { kind: "user", id: workspace.id, userId };
}

export async function getCurrentWorkspace(): Promise<Workspace> {
  const user = await getUserWorkspace();
  if (user) return user;
  const { getDemoWorkspace } = await import("../../../../agent/lib/workspace");
  return { kind: "demo", id: (await getDemoWorkspace()).id };
}
