// What a quick-connect GitHub repo webhook delivery should start (agent/channels/github-webhook.ts).
// Pure: no database, no network, so tests can drive it directly.

const LAUNCH_LABELS = new Set(["feature", "launch"]);
const MENTION = /(^|[^A-Za-z0-9_-])@roary(?![A-Za-z0-9_-])/i;
const MAX_COMMENT_CHARS = 4_000;

/** Roary ends its own comments with this, so a reply posted as the token's user never re-triggers it. */
export const ROARY_MARKER = "<!-- roary -->";

export type GithubWebhookPlan = { address: string; title: string; message: string };

export type GithubWebhookPayload = {
  action?: string;
  repository?: { full_name?: string };
  sender?: { login?: string; type?: string };
  issue?: { number?: number; title?: string; body?: string | null; html_url?: string; pull_request?: unknown };
  comment?: { body?: string; html_url?: string; user?: { login?: string; type?: string } };
  pull_request?: { number?: number; title?: string; merged?: boolean; labels?: { name?: string }[]; html_url?: string };
};

function replyRules(login: string): string {
  return (
    `Your comments post as @${login} (this workspace's GitHub token). Never write "@roary" in a comment, ` +
    `and end every comment you post with ${ROARY_MARKER} on its own line.`
  );
}

/**
 * - `issue_comment.created` mentioning @roary (not Roary's own marked reply, not a bot) → a
 *   session per issue/PR thread that answers with github__addIssueComment;
 * - `issues.opened` mentioning @roary → the same;
 * - `pull_request.closed` + merged + label feature/launch → the launch-video skill;
 * - anything else → null (acknowledged, nothing starts).
 */
export function planGithubEvent(event: string | null, body: GithubWebhookPayload, publicId: string, login: string): GithubWebhookPlan | null {
  const repo = body.repository?.full_name;
  if (!repo || !repo.includes("/")) return null;
  const [owner, name] = repo.split("/");

  if (event === "issue_comment" && body.action === "created" && body.issue?.number && body.comment?.body) {
    const text = body.comment.body;
    if (!MENTION.test(text) || text.includes(ROARY_MARKER) || body.comment.user?.type === "Bot") return null;
    const kind = body.issue.pull_request ? "pull request" : "issue";
    const n = body.issue.number;
    return {
      address: `github-pat:${publicId}:${repo}#${n}`,
      title: `@roary on ${repo}#${n}`,
      message:
        `[GitHub] @${body.comment.user?.login ?? body.sender?.login ?? "someone"} mentioned you in a comment on ${kind} #${n} ` +
        `("${body.issue.title ?? ""}") in ${repo}${body.comment.html_url ? ` (${body.comment.html_url})` : ""}:\n\n` +
        `${text.slice(0, MAX_COMMENT_CHARS)}\n\n` +
        `Read the thread with github__getIssueContext if you need more. Answer them on that thread with github__addIssueComment ` +
        `(owner "${owner}", repo "${name}", issueNumber ${n}). ${replyRules(login)}`,
    };
  }

  if (event === "issues" && body.action === "opened" && body.issue?.number) {
    const text = `${body.issue.title ?? ""}\n${body.issue.body ?? ""}`;
    if (!MENTION.test(text) || text.includes(ROARY_MARKER) || body.sender?.type === "Bot") return null;
    const n = body.issue.number;
    return {
      address: `github-pat:${publicId}:${repo}#${n}`,
      title: `@roary on ${repo}#${n}`,
      message:
        `[GitHub] @${body.sender?.login ?? "someone"} opened issue #${n} ("${body.issue.title ?? ""}") in ${repo} and mentioned you:\n\n` +
        `${(body.issue.body ?? "").slice(0, MAX_COMMENT_CHARS)}\n\n` +
        `Answer on that issue with github__addIssueComment (owner "${owner}", repo "${name}", issueNumber ${n}). ${replyRules(login)}`,
    };
  }

  if (event === "pull_request" && body.action === "closed" && body.pull_request?.merged === true && body.pull_request.number) {
    const pr = body.pull_request;
    const isLaunch = pr.labels?.some((label) => label.name && LAUNCH_LABELS.has(label.name.toLowerCase()));
    if (!isLaunch) return null;
    return {
      address: `github-pat-launch:${publicId}:${repo}#${pr.number}`,
      title: `Launch video for ${repo}#${pr.number}`,
      message:
        `PR #${pr.number} ("${pr.title ?? ""}") in ${repo} was just merged with a launch label. ` +
        `Load the launch-video skill, make the launch video for this PR and post it on the PR with github__addIssueComment ` +
        `(owner "${owner}", repo "${name}", issueNumber ${pr.number}) with a thank-you. ${replyRules(login)}`,
    };
  }
  return null;
}
