import { decryptSecret, encryptSecret, secretAad } from "./crypto";
import { getConnectionStore } from "./store";
import { type Connection, type Provider, type PublicConnection, toPublic } from "./types";
import { GITHUB_CONNECTOR, type Validation, validatePosthog, validateSentry, verifyGithubInstallation } from "./validate";

// Validate → encrypt → store. Routes call these; nothing here trusts the browser for
// a workspace id (callers pass the one from getCurrentWorkspace()).

export type SaveResult = { ok: true; connection: PublicConnection; checkedVia: string } | { ok: false; code: string; message: string };

function failed(v: Extract<Validation, { ok: false }>): SaveResult {
  return { ok: false, code: v.code, message: v.message };
}

export async function saveSentry(workspaceId: number, input: { token: string; org: string; project: string }): Promise<SaveResult> {
  const config = { org: input.org.trim(), project: input.project.trim() };
  const check = await validateSentry(input.token.trim(), config);
  if (!check.ok) return failed(check);
  const store = await getConnectionStore();
  const connection = await store.upsert({
    workspaceId,
    provider: "sentry",
    status: "connected",
    config,
    secretCiphertext: encryptSecret(input.token.trim(), secretAad(workspaceId, "sentry")),
    connectorRef: null,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
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
    secretCiphertext: encryptSecret(input.apiKey.trim(), secretAad(workspaceId, "posthog")),
    connectorRef: null,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
}

/**
 * Binds a GitHub App installation to a workspace. First claim wins: an installation
 * already bound elsewhere is refused, so a forged installation_id can't move it.
 */
export async function claimGithubInstallation(workspaceId: number, installationId: string): Promise<SaveResult> {
  const store = await getConnectionStore();
  const owner = await store.findByGithubInstallation(installationId);
  if (owner && owner.workspaceId !== workspaceId) {
    return { ok: false, code: "claimed", message: "That installation is already connected to another workspace." };
  }
  const check = await verifyGithubInstallation(installationId);
  if (!check.ok) return failed(check);
  const connection = await store.upsert({
    workspaceId,
    provider: "github",
    status: "connected",
    config: { installationId, repos: check.detail.repos },
    secretCiphertext: null, // Connect mints short-lived installation tokens on demand.
    connectorRef: GITHUB_CONNECTOR,
  });
  return { ok: true, connection: toPublic(connection), checkedVia: check.checkedVia };
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
  await store.setStatus(workspaceId, provider, check.ok ? "connected" : "error");
  if (!check.ok) return failed(check);
  const fresh = await store.get(workspaceId, provider);
  return { ok: true, connection: toPublic(fresh ?? row), checkedVia: check.checkedVia };
}

async function runCheck(row: Connection): Promise<Validation> {
  if (row.provider === "github") {
    const { installationId } = row.config as Connection<"github">["config"];
    if (!installationId) return { ok: false, code: "pending", message: "Waiting for an org owner to approve the install." };
    return verifyGithubInstallation(installationId);
  }
  if (!row.secretCiphertext) return { ok: false, code: "no_secret", message: "No credential stored. Connect again." };
  let secret: string;
  try {
    secret = decryptSecret(row.secretCiphertext, secretAad(row.workspaceId, row.provider));
  } catch {
    return { ok: false, code: "undecryptable", message: "The stored credential can't be read (key rotated?). Connect again." };
  }
  return row.provider === "sentry"
    ? validateSentry(secret, row.config as Connection<"sentry">["config"])
    : validatePosthog(secret, row.config as Connection<"posthog">["config"]);
}
