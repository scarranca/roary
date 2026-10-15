import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { handleLifecycleRequest, postgresLifecycleStore } from "../lib/github-lifecycle";

const LAUNCH_LABELS = new Set(["feature", "launch"]);
const credentials = connectGitHubCredentials("github/roary");

// Comment `@roary ...` on an issue, PR, or review thread to start a turn.
// Vercel Connect owns the GitHub App, installation tokens, and webhook verification.
const channel = githubChannel({
  botName: "roary",
  credentials,
  // A merged PR labeled `feature` or `launch` gets a launch video (agent/skills/launch-video.md).
  onPullRequest: (ctx, event) => {
    // `raw` is the webhook's `pull_request` object itself (eve unwraps it).
    const pr = event.raw as { merged?: boolean; title?: string; labels?: { name?: string }[] };
    const isLaunch = pr.labels?.some((label) => label.name && LAUNCH_LABELS.has(label.name.toLowerCase()));
    if (event.action !== "closed" || pr.merged !== true || !isLaunch) return null;
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

// githubChannel has no hook for App lifecycle events (`installation`, `installation_repositories`)
// and answers them `ignored`. Same route, same verifier: we peel those off first and update the
// claiming workspace's connection (agent/lib/github-lifecycle.ts); everything else goes to eve.
const lifecycle = { verify: credentials.webhookVerifier, store: postgresLifecycleStore };

export default {
  ...channel,
  routes: channel.routes.map((route) =>
    route.transport === "websocket" || route.method !== "POST"
      ? route
      : { ...route, handler: async (request: Request, args: Parameters<typeof route.handler>[1]) => (await handleLifecycleRequest(request, lifecycle)) ?? route.handler(request, args) },
  ),
};
