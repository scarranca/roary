import type { ConnectionProvider } from "./schema";
import { type Connection, type Principal, type ResolvedWorkspace, resolveWorkspace } from "./workspace";

type CallerContext = {
  readonly session: { readonly auth: { readonly current: Principal; readonly initiator: Principal } };
};

/**
 * The workspace for the active turn. The current caller decides it; internal runtime turns
 * with no caller (subagents) inherit the session initiator's workspace.
 */
export function workspaceForTurn(ctx: CallerContext): Promise<ResolvedWorkspace> {
  return resolveWorkspace(ctx.session.auth.current ?? ctx.session.auth.initiator);
}

const LABELS: Record<ConnectionProvider, string> = { sentry: "Sentry", posthog: "PostHog", github: "GitHub" };

function describeConnection(c: Connection): string {
  const config = c.config as Record<string, unknown>;
  switch (c.provider) {
    case "sentry":
      if (config.source === "sentry-app" && !config.project) return `Sentry org \`${config.org ?? "?"}\` (all projects, via the Roary Sentry app)`;
      return `Sentry org \`${config.org ?? "?"}\`, project \`${config.project ?? "?"}\``;
    case "posthog":
      return `PostHog project \`${config.projectId ?? "?"}\` (${config.host ?? "https://us.posthog.com"})`;
    case "github": {
      const repos = Array.isArray(config.repos) ? config.repos.map((r) => `\`${r}\``).join(", ") : "";
      return `GitHub repos ${repos || "(none selected)"}`;
    }
  }
}

/** One context line telling Roary which workspace this turn runs in and what it can reach. */
export async function workspaceContext(principal: Principal): Promise<string> {
  let resolved: ResolvedWorkspace;
  try {
    resolved = await resolveWorkspace(principal);
  } catch {
    return "[Workspace] Couldn't load this team's workspace right now. Don't use any Sentry, PostHog or GitHub data; say the workspace is temporarily unavailable.";
  }
  const { workspace } = resolved;
  const connected = resolved.connections.filter((c) => c.status !== "disabled" && c.status !== "disconnected");
  const missing = (Object.keys(LABELS) as ConnectionProvider[])
    .filter((p) => !connected.some((c) => c.provider === p))
    .map((p) => LABELS[p]);

  if (workspace.isDemo) {
    return `[Workspace] "${workspace.name}", the shared demo workspace (guest, not signed in). Connected: ${connected.map(describeConnection).join("; ")}.`;
  }
  const head = `[Workspace] "${workspace.name}", this signed-in person's own workspace (not the demo).`;
  const own = connected.length ? ` Connected: ${connected.map(describeConnection).join("; ")}.` : " Connected: nothing yet.";
  const gap = missing.length
    ? ` Not connected: ${missing.join(", ")}. Don't use the demo shop's Sentry, PostHog or repo for this team; if they ask for something that needs ${missing.join(" or ")}, say this workspace has no ${missing.join("/")} connection yet and that they can connect it from Roary's setup.`
    : "";
  return head + own + gap;
}
