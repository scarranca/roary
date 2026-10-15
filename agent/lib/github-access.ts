import { getToken } from "@vercel/connect";
import { workspaceForTurn } from "./workspace-context";
import { credentialFor, findConnection, type ResolvedWorkspace } from "./workspace";

const GITHUB_CONNECTOR = "github/roary";

export type GithubAccess =
  | { ok: true; repos: string[]; token: (repo: string) => Promise<string>; commentsOptIn: boolean }
  | { ok: false; error: string; message: string };

/**
 * GitHub repos and a token for this workspace, for the launch-review tools that call the REST API
 * directly (the extension's tools don't expose merge times or deployments). Only the workspace's
 * connected repos are reachable. The demo workspace uses the shared GitHub App installation that
 * owns each repo; a signed-in workspace gets a token pinned to its own installation.
 */
export async function githubAccessFor(resolved: ResolvedWorkspace): Promise<GithubAccess> {
  const connection = findConnection(resolved, "github");
  const config = (connection?.config ?? {}) as { repos?: unknown; launchReviewComments?: unknown };
  const repos = Array.isArray(config.repos) ? config.repos.filter((r): r is string => typeof r === "string") : [];
  if (!connection || connection.status !== "connected" || !repos.length) {
    return {
      ok: false,
      error: "no_github_connection",
      message: "This workspace has no GitHub connection (or no repos selected), so I can't see what shipped. Ask the team to connect GitHub in Roary's setup.",
    };
  }
  // Opt-in only: the daily review may comment on the newest merged PR when this is true.
  const commentsOptIn = config.launchReviewComments === true;
  if (resolved.workspace.isDemo) {
    return {
      ok: true,
      repos,
      commentsOptIn,
      token: (repo) => {
        const [org, name] = repo.split("/");
        return getToken(GITHUB_CONNECTOR, {
          subject: { type: "app" },
          authorizationDetails: [{ type: "github_app_installation", org, repositories: [name!] }],
        });
      },
    };
  }
  return {
    ok: true,
    repos,
    commentsOptIn,
    token: async () => {
      const token = await credentialFor(resolved, connection, undefined);
      if (!token) throw new Error("github_token_missing");
      return token;
    },
  };
}

export async function githubAccess(ctx: Parameters<typeof workspaceForTurn>[0]): Promise<GithubAccess> {
  return githubAccessFor(await workspaceForTurn(ctx));
}
