// Unit checks for apps/web/lib/connections/crypto.ts and the GitHub install state.
// Run: npx tsx scripts/connections-crypto-test.ts   (no network, no secrets needed)
import { randomBytes } from "node:crypto";

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const saved = process.env.CONNECTIONS_ENCRYPTION_KEY;
delete process.env.CONNECTIONS_ENCRYPTION_KEY;
const crypto = await import("../apps/web/lib/connections/crypto");
const { checkState, startInstall } = await import("../apps/web/lib/connections/github-state");

check("import works without a key; hasEncryptionKey() is false", crypto.hasEncryptionKey() === false);
check("encrypt without a key throws MissingKeyError", throws(() => crypto.encryptSecret("x", "1:sentry")));

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("hex");
process.env.CONNECTIONS_ENCRYPTION_KEY = keyA;
check("base64 key accepted", crypto.hasEncryptionKey());

const secret = "sntrys_example-token-0123456789";
const aad = crypto.secretAad(42, "sentry");
const sealed = crypto.encryptSecret(secret, aad);
check("ciphertext has v1 format and hides the plaintext", sealed.startsWith("v1.") && !sealed.includes(secret));
check("round trip returns the plaintext", crypto.decryptSecret(sealed, aad) === secret);
check("same plaintext encrypts differently each time (random IV)", crypto.encryptSecret(secret, aad) !== sealed);
check("wrong row (AAD) fails to decrypt", throws(() => crypto.decryptSecret(sealed, crypto.secretAad(43, "sentry"))));
const parts = sealed.split(".");
const flipped = parts[3][0] === "A" ? "B" : "A";
check("tampered ciphertext fails", throws(() => crypto.decryptSecret([...parts.slice(0, 3), flipped + parts[3].slice(1)].join("."), aad)));
check("garbage input fails", throws(() => crypto.decryptSecret("nope", aad)));
check("unicode round trip", crypto.decryptSecret(crypto.encryptSecret("clé·🦁", aad), aad) === "clé·🦁");

process.env.CONNECTIONS_ENCRYPTION_KEY = keyB;
check("hex key accepted", crypto.hasEncryptionKey());
check("a different key can't decrypt", throws(() => crypto.decryptSecret(sealed, aad)));
process.env.CONNECTIONS_ENCRYPTION_KEY = "too-short";
check("a key that isn't 32 bytes is rejected", !crypto.hasEncryptionKey());

process.env.CONNECTIONS_ENCRYPTION_KEY = keyA;
const signed = crypto.signPayload({ w: 7, n: "abc", e: Date.now() + 60_000 });
check("signed payload verifies", crypto.verifyPayload<{ w: number }>(signed)?.w === 7);
const [body, mac] = signed.split(".");
const forged = `${Buffer.from(JSON.stringify({ w: 8, n: "abc", e: Date.now() + 60_000 })).toString("base64url")}.${mac}`;
check("forged payload is rejected", crypto.verifyPayload(forged) === null && crypto.verifyPayload(`${body}.x`) === null);

const install = startInstall(7);
const state = new URL(install.url).searchParams.get("state");
check("install URL targets the myroary app", install.url.startsWith("https://github.com/apps/myroary/installations/new?state="));
check("state + matching nonce cookie → workspace 7", (() => {
  const r = checkState(state, install.nonce);
  return r.ok && r.workspaceId === 7;
})());
check("state from another browser (nonce mismatch) is refused", (() => {
  const r = checkState(state, "other");
  return !r.ok && r.reason === "browser";
})());
check("missing state is refused", !checkState(null, install.nonce).ok);
const expired = crypto.signPayload({ w: 7, n: "n", e: Date.now() - 1 });
check("expired state is refused", (() => {
  const r = checkState(expired, "n");
  return !r.ok && r.reason === "expired";
})());

if (saved === undefined) delete process.env.CONNECTIONS_ENCRYPTION_KEY;
else process.env.CONNECTIONS_ENCRYPTION_KEY = saved;

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
