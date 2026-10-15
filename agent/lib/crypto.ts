import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// The ONE encryption helper for connection secrets, shared by the web app (apps/web, which
// writes them) and the agent (agent/lib/workspace.ts, which reads them). No Next or eve imports.
//
// AES-256-GCM with a subkey derived (HKDF-SHA256, info "roary:connections-secret") from
// CONNECTIONS_ENCRYPTION_KEY. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). The additional
// data binds a ciphertext to its row (`<workspaceId>:<provider>`, see secretAad), so a secret
// copied into another workspace's row fails to decrypt instead of leaking.

const VERSION = "v1";

export class MissingKeyError extends Error {
  constructor() {
    super("CONNECTIONS_ENCRYPTION_KEY is not set (32 bytes, base64 or hex).");
    this.name = "MissingKeyError";
  }
}

/** Read lazily, so importing this module never throws during `next build`. */
function masterKey(): Buffer {
  const raw = process.env.CONNECTIONS_ENCRYPTION_KEY?.trim();
  if (!raw) throw new MissingKeyError();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTIONS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

/** A purpose-specific subkey, so the state-signing key is never the encryption key. */
function subkey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `roary:${purpose}`, 32));
}

export function hasEncryptionKey(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("connections-secret"), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string, aad: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv("aes-256-gcm", subkey("connections-secret"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function secretAad(workspaceId: number, provider: string) {
  return `${workspaceId}:${provider}`;
}

/** Encrypts a provider credential for the `connections` row (workspaceId, provider). */
export function sealConnectionSecret(workspaceId: number, provider: string, plaintext: string): string {
  return encryptSecret(plaintext, secretAad(workspaceId, provider));
}

/** Decrypts a `connections.secret_ciphertext` with that row's own AAD. */
export function openConnectionSecret(row: { workspaceId: number; provider: string; secretCiphertext: string }): string {
  return decryptSecret(row.secretCiphertext, secretAad(row.workspaceId, row.provider));
}

/** A webhook signing secret's AAD differs from the API token's, so neither can stand in for the other. */
function webhookAad(workspaceId: number, provider: string) {
  return `${secretAad(workspaceId, provider)}:webhook`;
}

/** Encrypts a workspace's own webhook signing secret for `connections.webhook_secret_ciphertext`. */
export function sealWebhookSecret(workspaceId: number, provider: string, plaintext: string): string {
  return encryptSecret(plaintext, webhookAad(workspaceId, provider));
}

/** Decrypts `connections.webhook_secret_ciphertext` with that row's own AAD. */
export function openWebhookSecret(row: { workspaceId: number; provider: string; webhookSecretCiphertext: string }): string {
  return decryptSecret(row.webhookSecretCiphertext, webhookAad(row.workspaceId, row.provider));
}

/** A fresh random webhook secret (GitHub repo webhooks), 32 bytes as hex. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** `<payload>.<hmac>`: tamper-evident, not secret. Used for the GitHub install `state`. */
export function signPayload(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", subkey("connect-state")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T>(signed: string): T | null {
  const [body, mac] = signed.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", subkey("connect-state")).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---- Guest identity -------------------------------------------------------------------------
// Anonymous visitors get a random id in an httpOnly cookie, `<id>.<hmac>`, set by the web app
// (apps/web/proxy.ts) and verified by the eve channel, so a guest owns the chats they start
// without signing in. The HMAC uses its own subkey.

export const GUEST_COOKIE = "roary_guest";
const GUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function newGuestId(): string {
  return randomBytes(18).toString("base64url");
}

export function signGuestId(id: string): string {
  if (!GUEST_ID.test(id)) throw new Error("Invalid guest id.");
  return `${id}.${createHmac("sha256", subkey("guest-cookie")).update(id).digest("base64url")}`;
}

/** The guest id from a signed cookie value, or null if it is missing, malformed or forged. */
export function verifyGuestCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const [id, mac, extra] = value.split(".");
  if (!id || !mac || extra !== undefined || !GUEST_ID.test(id)) return null;
  try {
    const expected = createHmac("sha256", subkey("guest-cookie")).update(id).digest();
    const given = Buffer.from(mac, "base64url");
    return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
  } catch {
    return null; // no CONNECTIONS_ENCRYPTION_KEY: nobody is a verified guest
  }
}

/** One cookie's value from a raw `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
