// "Quick connect: paste your keys" — the pure part (no database, no network), shared by the agent
// and the web app. The database side (webhook targets, delivery claims) is agent/lib/quick-connect.ts.

/** workspaces.public_id: 32 lowercase hex chars (a uuid without dashes). */
export const PUBLIC_ID = /^[0-9a-f]{32}$/;

/** The authenticator stamped on turns started by a workspace's own GitHub repo webhook. */
export const GITHUB_PAT_WEBHOOK_AUTHENTICATOR = "github-pat-webhook";

/** `connections.config` of a GitHub connection made with a personal access token. */
export type GithubPatConfig = { mode: "pat"; repos: string[]; login: string; expiresAt: string | null };

export function githubPatConfig(connection: { provider: string; config: unknown } | undefined | null): GithubPatConfig | null {
  const config = (connection?.config ?? {}) as Partial<GithubPatConfig>;
  return connection?.provider === "github" && config.mode === "pat" && Array.isArray(config.repos) ? (config as GithubPatConfig) : null;
}

/** `connections.config` of a pasted Sentry token that also carries an internal integration's webhook. */
export type SentryInternalConfig = { org: string; project: string; source: "internal" };

export function sentryInternalConfig(connection: { provider: string; config: unknown } | undefined | null): SentryInternalConfig | null {
  const config = (connection?.config ?? {}) as Partial<SentryInternalConfig>;
  return connection?.provider === "sentry" && config.source === "internal" ? (config as SentryInternalConfig) : null;
}

/** Paths a team pastes into GitHub / Sentry (the web app prefixes its own origin). */
export function webhookPaths(publicId: string) {
  return { github: `/github/webhook/${publicId}`, sentry: `/sentry/webhook/${publicId}` };
}
