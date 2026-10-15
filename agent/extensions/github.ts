import githubExtension from "@github-tools/eve-extension";
import { GITHUB_EXCLUDE, GITHUB_PRESET, githubToken } from "../lib/github-token";
import { turnPrincipal } from "../lib/turn-principal";

// Mounted as an extension (the registry's `extension/github-tools` path) rather than
// `createGithubTools` in agent/tools/, which is deprecated and not durable across
// multi-turn workflow replay. Tools are exposed as `github__<toolName>`.
//
// No `connector` here: the extension would then always ask Vercel Connect. The token provider
// picks per workspace instead (agent/lib/github-token.ts): a quick-connect workspace's personal
// access token, or the GitHub App via Connect exactly as before. Token providers get no tool
// context, so the turn's principal comes from durable state set on turn.started
// (agent/hooks/turn-principal.ts).
export default githubExtension({
  token: (call) => githubToken(turnPrincipal.get(), call),
  preset: [...GITHUB_PRESET],
  exclude: [...GITHUB_EXCLUDE],
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
