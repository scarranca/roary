import githubExtension from "@github-tools/eve-extension";

// Mounted as an extension (the registry's `extension/github-tools` path) rather than
// `createGithubTools` in agent/tools/, which is deprecated and not durable across
// multi-turn workflow replay. Tools are exposed as `github__<toolName>`.
export default githubExtension({
  connector: "github/roary",
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
