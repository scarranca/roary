import { newWebhookSecret, openConnectionSecret, sealConnectionSecret, sealWebhookSecret } from "../../../../agent/lib/crypto";
import { githubPatConfig } from "../../../../agent/lib/quick-connect-config";
import { type SentryAppConfig, sentryAppConfig } from "../../../../agent/lib/sentry-app";
import { getConnectionStore, InstallationClaimedError } from "./store";
import { type Connection, type Provider, type PublicConnection, type SentryConfig, toPublic } from "./types";
import {
  GITHUB_CONNECTOR,
  type Validation,
  validateGithubPat,
  validatePosthog,
  validateSentry,
  validateSentryOrg,
  verifyGithubInstallation,
} from "./validate";

// Validate → encrypt → store. Routes call these; nothing here trusts the browser for
// a workspace id (callers pass the one from getCurrentWorkspace()).

export type SaveResult = { ok: true; connection: PublicConnection; checkedVia: string } | { ok: false; code: string; message: string };

function failed(v: Extract<Validation, { ok: false }>): SaveResult {
  return { ok: false, code: v.code, message: v.message };
}

/**
 * A pasted Sentry token. With the internal integration's client secret too (quick connect), the
 * secret is stored encrypted and that integration's alerts, sent to /sentry/webhook/<public id>,
 * start triage in this workspace.
 */
export async function saveSentry(
  workspaceId: number,
  input: { token: string; org: string; project: string; clientSecret?: string },
): Promise<SaveResult> {
  const base = { org: input.org.trim(), project: input.project.trim() };
  const check = await validateSentry(input.token.trim(), base);
  if (!check.ok) return failed(check);
  const clientSecret = input.clientSecret?.trim();
  const store = await getConnectionStore();
  const connection = await store.upsert({
    workspaceId,
    provider: "sentry",
    status: "connected",
    config: clientSecret ? { ...base, source: "internal" as const } : base,
    secretCiphertext: sealConnectionSecret(workspaceId, "sentry", input.token.trim()),
    webhookSecretCiphertext: clientSecret ? sealWebhookSecret(workspaceId, "sentry", clientSecret) : null,
    connectorRef: null,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
}

export type GithubPatResult = { ok: true; connection: PublicConnection; checkedVia: string; webhookSecret?: string } | { ok: false; code: string; message: string };

/**
 * Quick connect for GitHub: a fine-grained personal access token + repos, checked live, stored
 * encrypted with config {mode: "pat", repos, login, expiresAt}. The first connect also creates
 * the workspace's webhook secret, returned ONCE here (the card shows it with a copy button);
 * replacing the token keeps the existing secret so the repo webhook keeps working.
 */
export async function saveGithubPat(workspaceId: number, input: { token: string; repos: string | string[] }): Promise<GithubPatResult> {
  const token = input.token.trim();
  const check = await validateGithubPat(token, input.repos);
  if (!check.ok) return { ok: false, code: check.code, message: check.message };
  const store = await getConnectionStore();
  const existing = await store.get(workspaceId, "github");
  const keepSecret = Boolean(existing?.webhookSecretCiphertext && githubPatConfig(existing));
  const webhookSecret = keepSecret ? undefined : newWebhookSecret();
  const connection = await store.upsert({
    workspaceId,
    provider: "github",
    status: "connected",
    config: { mode: "pat" as const, repos: check.detail.repos, login: check.detail.login, expiresAt: check.detail.expiresAt },
    secretCiphertext: sealConnectionSecret(workspaceId, "github", token),
    ...(webhookSecret ? { webhookSecretCiphertext: sealWebhookSecret(workspaceId, "github", webhookSecret) } : {}),
    connectorRef: null,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia, ...(webhookSecret ? { webhookSecret } : {}) };
}

/** A new GitHub webhook secret for a token-connected workspace, returned once. The old one stops working. */
export async function rotateGithubWebhookSecret(workspaceId: number): Promise<{ ok: true; webhookSecret: string } | { ok: false; message: string }> {
  const store = await getConnectionStore();
  const existing = await store.get(workspaceId, "github");
  if (!existing || !githubPatConfig(existing)) return { ok: false, message: "Connect GitHub with a token first." };
  const webhookSecret = newWebhookSecret();
  const { status, config, secretCiphertext, connectorRef } = existing;
  await store.upsert({
    workspaceId,
    provider: "github",
    status,
    config,
    secretCiphertext,
    connectorRef,
    webhookSecretCiphertext: sealWebhookSecret(workspaceId, "github", webhookSecret),
  });
  return { ok: true, webhookSecret };
}

export async function savePosthog(workspaceId: number, input: { apiKey: string; projectId: string; host: string }): Promise<SaveResult> {
  const config = { projectId: input.projectId.trim(), host: input.host };
  const check = await validatePosthog(input.apiKey.trim(), config);
  if (!check.ok) return failed(check);
  const store = await getConnectionStore();
  const connection = await store.upsert({
    workspaceId,
    provider: "posthog",
    status: "connected",
    config,
    secretCiphertext: sealConnectionSecret(workspaceId, "posthog", input.apiKey.trim()),
    connectorRef: null,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
}

const CLAIMED: SaveResult = { ok: false, code: "claimed", message: "That installation is already connected to another workspace." };

/**
 * Binds a GitHub App installation to a workspace. First claim wins: an installation
 * already bound elsewhere is refused, so a forged installation_id can't move it. The read
 * below is only the friendly fast path; the unique index on the installation id
 * (drizzle/0004) is what makes two concurrent claims impossible.
 */
export async function claimGithubInstallation(workspaceId: number, installationId: string): Promise<SaveResult> {
  const store = await getConnectionStore();
  const owner = await store.findByGithubInstallation(installationId);
  if (owner && owner.workspaceId !== workspaceId) return CLAIMED;
  const check = await verifyGithubInstallation(installationId);
  if (!check.ok) return failed(check);
  try {
    const connection = await store.upsert({
      workspaceId,
      provider: "github",
      status: "connected",
      config: { installationId, repos: check.detail.repos },
      secretCiphertext: null, // Connect mints short-lived installation tokens on demand.
      webhookSecretCiphertext: null, // App events arrive through Connect, not a repo webhook.
      connectorRef: GITHUB_CONNECTOR,
    });
    return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
  } catch (error) {
    if (error instanceof InstallationClaimedError) return CLAIMED;
    throw error;
  }
}

/** GitHub said the org owner must approve: remember it so the card can say so. */
export async function markGithubPending(workspaceId: number) {
  const store = await getConnectionStore();
  const existing = await store.get(workspaceId, "github");
  if (existing?.status === "connected") return;
  await store.upsert({
    workspaceId,
    provider: "github",
    status: "pending",
    config: { installationId: "", repos: [] },
    secretCiphertext: null,
    connectorRef: GITHUB_CONNECTOR,
  });
}

/** Re-runs the provider check with the stored (decrypted) credential; returns status only. */
export async function testConnection(workspaceId: number, provider: Provider): Promise<SaveResult> {
  const store = await getConnectionStore();
  const row = await store.get(workspaceId, provider);
  if (!row) return { ok: false, code: "not_connected", message: "Nothing connected yet." };
  const check = await runCheck(row);
  await store.setStatus(workspaceId, provider, check.ok ? "connected" : check.code === "uninstalled" ? "disconnected" : "error");
  if (!check.ok) return failed(check);
  const fresh = await store.get(workspaceId, provider);
  return { ok: true, connection: toPublic(fresh ?? row), checkedVia: check.checkedVia };
}

/** A Sentry App install: refresh the installation token if due (same path as the agent), then read the org's issues. */
async function checkSentryApp(config: SentryAppConfig): Promise<Validation> {
  const { findSentryInstallation, sentryAppToken } = await import("../../../../agent/lib/sentry-app-store");
  const row = await findSentryInstallation(config.installationUuid);
  if (!row || row.status === "disconnected") {
    return { ok: false, code: "uninstalled", message: "Roary was uninstalled in Sentry. Install it again." };
  }
  let token: string | null;
  try {
    token = await sentryAppToken(row);
  } catch {
    return { ok: false, code: "refresh_failed", message: "Sentry didn't renew Roary's access. Install it again." };
  }
  if (!token) return { ok: false, code: "no_secret", message: "No Sentry token stored. Install Roary in Sentry again." };
  return validateSentryOrg(token, config.org);
}

async function runCheck(row: Connection): Promise<Validation> {
  const pat = githubPatConfig(row);
  if (pat) {
    if (!row.secretCiphertext) return { ok: false, code: "no_secret", message: "No token stored. Connect again." };
    let token: string;
    try {
      token = openConnectionSecret({ ...row, secretCiphertext: row.secretCiphertext });
    } catch {
      return { ok: false, code: "undecryptable", message: "The stored token can't be read (key rotated?). Connect again." };
    }
    return validateGithubPat(token, pat.repos);
  }
  if (row.provider === "github") {
    const { installationId } = row.config as Connection<"github">["config"];
    if (!installationId) return { ok: false, code: "pending", message: "Waiting for an org owner to approve the install." };
    return verifyGithubInstallation(installationId);
  }
  const app = sentryAppConfig(row);
  if (app) return checkSentryApp(app);
  if (!row.secretCiphertext) return { ok: false, code: "no_secret", message: "No credential stored. Connect again." };
  let secret: string;
  try {
    secret = openConnectionSecret({ ...row, secretCiphertext: row.secretCiphertext });
  } catch {
    return { ok: false, code: "undecryptable", message: "The stored credential can't be read (key rotated?). Connect again." };
  }
  return row.provider === "sentry"
    ? validateSentry(secret, row.config as SentryConfig)
    : validatePosthog(secret, row.config as Connection<"posthog">["config"]);
}
