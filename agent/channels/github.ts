import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

const LAUNCH_LABELS = new Set(["feature", "launch"]);

// Comment `@roary ...` on an issue, PR, or review thread to start a turn.
// Vercel Connect owns the GitHub App, installation tokens, and webhook verification.
export default githubChannel({
  botName: "roary",
  credentials: connectGitHubCredentials("github/roary"),
  // A merged PR labeled `feature` or `launch` gets a launch video (agent/skills/launch-video.md).
  onPullRequest: (ctx, event) => {
    const pr = event.raw.pull_request as
      | { merged?: boolean; title?: string; labels?: { name?: string }[] }
      | undefined;
    const isLaunch = pr?.labels?.some((label) => label.name && LAUNCH_LABELS.has(label.name.toLowerCase()));
    if (event.action !== "closed" || pr?.merged !== true || !isLaunch) return null;
    return {
      auth: defaultGitHubAuth(ctx),
      title: `Launch video for PR #${event.pullRequestNumber}`,
      context: [
        `PR #${event.pullRequestNumber} ("${pr.title ?? ""}") was just merged with a launch label. ` +
          "Load the launch-video skill, make the launch video for this PR and post it here with a thank-you.",
      ],
    };
  },
});
