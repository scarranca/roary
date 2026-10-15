import type { GithubTokenCall } from "@github-tools/sdk";
import { connectGithubToken } from "@github-tools/sdk/connect";
import { githubPatConfig } from "./quick-connect-config";
import { credentialFor, findConnection, type Principal, type ResolvedWorkspace, resolveWorkspace } from "./workspace";

// The GitHub tools' credential (agent/extensions/github.ts), per tool call and per workspace.
export const GITHUB_CONNECTOR = "github/roary";

// pr-author adds createBranch / createOrUpdateFile / createPullRequest for fix PRs.
export const GITHUB_PRESET = ["code-review", "issue-triage", "pr-author"] as const;
// Humans merge. Roary never deletes branches, labels or other people's comments.
export const GITHUB_EXCLUDE = ["mergePullRequest", "deleteBranch", "deleteLabel", "deleteIssueComment", "deletePullRequestComment"] as const;

/**
 * Connect params for the GitHub App path. The App is shared, so the workspace decides what a
 * turn may touch. The demo workspace keeps the app's default (the installation owning each
 * call's repo). A signed-in workspace (or a GitHub event routed to one by installation id) must
 * have connected GitHub through this connector (`connector_ref`), and calls are pinned to its
 * installation and repos: Connect mints an installation token for exactly that installationId.
 */
function appParams(resolved: ResolvedWorkspace, call: GithubTokenCall | undefined) {
  if (resolved.workspace.isDemo) return {};
  const connection = findConnection(resolved, "github");
  const config = (connection?.config ?? {}) as { installationId?: number | string; repos?: string[] };
  if (!connection || !config.installationId || connection.status !== "connected") {
    throw new Error("This workspace has no GitHub connection yet. Ask the team to connect GitHub in Roary's setup.");
  }
  if ((connection.connectorRef ?? GITHUB_CONNECTOR) !== GITHUB_CONNECTOR) {
    throw new Error(`This workspace's GitHub is connected through ${connection.connectorRef}, which Roary's GitHub tools don't use.`);
  }
  const repos = config.repos ?? [];
  if (call?.owner && call.repo && !repos.includes(`${call.owner}/${call.repo}`)) {
    throw new Error(`${call.owner}/${call.repo} isn't one of this workspace's connected repos (${repos.join(", ") || "none"}).`);
  }
  return { installationId: String(config.installationId), repositories: repos.map((r) => r.split("/")[1]!) };
}

/**
 * The token for one tool call, chosen by the turn's workspace (the principal recorded by
 * agent/hooks/turn-principal.ts, since the extension hands token providers no tool context):
 * - a workspace that pasted a personal access token (quick connect) → that PAT, only for its
 *   listed repos. It never reaches Connect, so it can't fall back to the demo's app token;
 * - otherwise the GitHub App via Vercel Connect, exactly as before (appParams).
 */
export async function githubToken(principal: Principal, call?: GithubTokenCall): Promise<string> {
  if (!principal) throw new Error("Roary's GitHub tools couldn't tell which workspace this turn belongs to. Try again.");
  const resolved = await resolveWorkspace(principal);
  const connection = findConnection(resolved, "github");
  const pat = githubPatConfig(connection);
  if (pat) {
    const target = call?.owner && call.repo ? `${call.owner}/${call.repo}`.toLowerCase() : undefined;
    if (target && !pat.repos.some((r) => r.toLowerCase() === target)) {
      throw new Error(`${call!.owner}/${call!.repo} isn't one of this workspace's connected repos (${pat.repos.join(", ") || "none"}).`);
    }
    const token = await credentialFor(resolved, connection, undefined);
    if (!token) throw new Error("This workspace's GitHub token isn't usable. Ask the team to reconnect GitHub in Roary's setup.");
    return token;
  }
  // Always a provider function at runtime; typed as the wider GithubTokenInput.
  const appToken = connectGithubToken(GITHUB_CONNECTOR, {
    preset: [...GITHUB_PRESET],
    exclude: [...GITHUB_EXCLUDE],
    params: (c) => appParams(resolved, c),
  }) as (call?: GithubTokenCall) => Promise<string>;
  return appToken(call);
}

