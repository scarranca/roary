// The `connections` contract shared with santiago/connect-foundation: one row per
// (workspace, provider). `config` is public metadata; the credential lives only in
// `secret_ciphertext` (AES-256-GCM, see ./crypto.ts).

import type { SentryAppConfig } from "../../../../agent/lib/sentry-app";

export const PROVIDERS = ["github", "sentry", "posthog"] as const;
export type Provider = (typeof PROVIDERS)[number];

// "disconnected": uninstalled on the provider side (GitHub App `installation.deleted`,
// agent/lib/github-lifecycle.ts; Sentry App `installation.deleted`, agent/lib/sentry-app-store.ts).
export type ConnectionStatus = "pending" | "connected" | "error" | "disconnected";

export type GithubConfig = { installationId: string; repos: string[] };
/** A pasted Sentry token's org + project. */
export type SentryConfig = { org: string; project: string };
export type PosthogConfig = { projectId: string; host: string };

export type ConfigFor<P extends Provider> = P extends "github"
  ? GithubConfig
  : P extends "sentry"
    ? SentryConfig | SentryAppConfig // the second: installed via the public Sentry App, org-wide
    : PosthogConfig;

export type Connection<P extends Provider = Provider> = {
  workspaceId: number;
  provider: P;
  status: ConnectionStatus;
  config: ConfigFor<P>;
  secretCiphertext: string | null;
  /** Vercel Connect connector UID when the credential is brokered there (github/roary, sentry/sentry). */
  connectorRef: string | null;
  updatedAt: string;
};

/** What the browser may see: never the ciphertext. */
export type PublicConnection = Omit<Connection, "secretCiphertext"> & { hasSecret: boolean };

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function toPublic(connection: Connection): PublicConnection {
  const { secretCiphertext, ...rest } = connection;
  return { ...rest, hasSecret: secretCiphertext !== null };
}
