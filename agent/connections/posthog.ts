import { defineMcpClientConnection } from "eve/connections";
import { workspaceForTurn } from "../lib/workspace-context";
import { findConnection, tokenFor } from "../lib/workspace";

// PostHog personal API key (scope preset "MCP Server") chosen per turn from the caller's
// workspace: its own encrypted key, or for the demo workspace the app-level POSTHOG_API_KEY.
// Not Vercel Connect OAuth: its PostHog token exchange fails, and autonomous runs (Sentry
// alerts, GitHub webhooks) have no signed-in user anyway.
export default defineMcpClientConnection({
  url: "https://mcp.posthog.com/mcp",
  description: "PostHog: insights, events, and feature flags for this workspace's connected PostHog project.",
  auth: async (ctx) => {
    const resolved = await workspaceForTurn(ctx);
    const token = tokenFor(resolved, findConnection(resolved, "posthog"), process.env.POSTHOG_API_KEY);
    return {
      credentialOwner: "app",
      getToken: async () => {
        if (!token) throw new Error("This workspace has no PostHog connection yet. Ask the team to connect PostHog in Roary's setup.");
        return { token };
      },
    };
  },
});
