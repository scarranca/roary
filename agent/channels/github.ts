import { connectGitHubCredentials } from "@vercel/connect/eve";
import { githubChannel } from "eve/channels/github";

// Comment `@roary ...` on an issue, PR, or review thread to start a turn.
// Vercel Connect owns the GitHub App, installation tokens, and webhook verification.
export default githubChannel({
  botName: "roary",
  credentials: connectGitHubCredentials("github/roary"),
});
