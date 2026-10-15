import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for connection secrets. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
// The additional data binds a ciphertext to its row (`<workspaceId>:<provider>`), so a
// secret copied into another workspace's row fails to decrypt instead of leaking.

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
