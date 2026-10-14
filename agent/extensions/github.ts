import githubExtension from "@github-tools/eve-extension";
import { workspaceForTurn } from "../lib/workspace-context";
import { findConnection } from "../lib/workspace";

// Mounted as an extension (the registry's `extension/github-tools` path) rather than
// `createGithubTools` in agent/tools/, which is deprecated and not durable across
// multi-turn workflow replay. Tools are exposed as `github__<toolName>`.
export default githubExtension({
  connector: "github/roary",
  // The GitHub App is shared, so the workspace decides what a turn may touch. The demo
  // workspace keeps the app's default (the installation owning each call's repo). A signed-in
  // workspace must have connected GitHub, and calls are pinned to its installation and repos.
  connect: async (ctx, call) => {
    const resolved = await workspaceForTurn(ctx);
    if (resolved.workspace.isDemo) return {};
    const connection = findConnection(resolved, "github");
    const config = (connection?.config ?? {}) as { installationId?: number | string; repos?: string[] };
    if (!connection || !config.installationId) {
      throw new Error("This workspace has no GitHub connection yet. Ask the team to connect GitHub in Roary's setup.");
    }
    const repos = config.repos ?? [];
    if (call.owner && call.repo && !repos.includes(`${call.owner}/${call.repo}`)) {
      throw new Error(`${call.owner}/${call.repo} isn't one of this workspace's connected repos (${repos.join(", ") || "none"}).`);
    }
    return { installationId: String(config.installationId), repositories: repos.map((r) => r.split("/")[1]!) };
  },
  // pr-author adds createBranch / createOrUpdateFile / createPullRequest for fix PRs.
  preset: ["code-review", "issue-triage", "pr-author"],
  // Humans merge. Roary never deletes branches, labels or other people's comments.
  exclude: [
    "mergePullRequest",
    "deleteBranch",
    "deleteLabel",
    "deleteIssueComment",
    "deletePullRequestComment",
  ],
  // Write tools default to always(). On GitHub an approval is a comment the human has to
  // answer, so the everyday collaborative writes run unprompted; everything else
  // (closeIssue, updatePullRequest, label edits, ...) keeps the default gate.
  requireApproval: {
    mergePullRequest: true,
    addIssueComment: false,
    addPullRequestComment: false,
    createPullRequestReview: false,
    replyToReviewComment: false,
    addIssueReaction: false,
    addCommentReaction: false,
    createIssue: false,
    addLabels: false,
    createBranch: false,
    createPullRequest: false,
    // Commits are fine on Roary's own branches, never straight to the default branch.
    createOrUpdateFile: ({ toolInput }) => {
      const branch = (toolInput as { branch?: string } | undefined)?.branch;
      return !branch || branch === "main" || branch === "master";
    },
  },
});
