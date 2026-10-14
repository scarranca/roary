import { defineMcpClientConnection } from "eve/connections";

// App-level PostHog personal API key (scope preset "MCP Server"), not per-user OAuth:
// Vercel Connect's PostHog OAuth token exchange fails, and autonomous runs (Sentry alerts,
// GitHub webhooks) have no signed-in user anyway.
export default defineMcpClientConnection({
  url: "https://mcp.posthog.com/mcp",
  description: "PostHog: insights, events, and feature flags.",
  auth: {
    credentialOwner: "app",
    getToken: async () => ({ token: process.env.POSTHOG_API_KEY! }),
  },
});
