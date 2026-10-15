// Unit checks for agent/lib/crypto.ts (the shared helper) and the GitHub install state.
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
const crypto = await import("../agent/lib/crypto");
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

// ---- One scheme across the boundary: the web app seals, the agent opens ------------------
// The web app's service stores sealConnectionSecret(workspaceId, provider, token); the agent's
// credentialFor() (agent/lib/workspace.ts) must turn that row back into the token, and only for
// that row. No database needed: credentialFor works on the resolved rows.
process.env.CONNECTIONS_STORE = "memory";
const service = await import("../apps/web/lib/connections/service");
const { getConnectionStore } = await import("../apps/web/lib/connections/store");
const { credentialFor } = await import("../agent/lib/workspace");
const memory = await getConnectionStore();
const token = `sntrys_${randomBytes(12).toString("hex")}`;
await memory.upsert({
  workspaceId: 77,
  provider: "sentry",
  status: "connected",
  config: { org: "acme", project: "web" },
  secretCiphertext: crypto.sealConnectionSecret(77, "sentry", token),
  connectorRef: null,
});
const webRow = (await memory.get(77, "sentry"))!;
const asAgentRow = (workspaceId: number, isDemo: boolean) => {
  const now = new Date();
  const connection = { ...webRow, id: 1, workspaceId, createdAt: now, updatedAt: now, config: webRow.config as Record<string, unknown> };
  return { resolved: { workspace: { id: workspaceId, name: "w", ownerUserId: "u", isDemo, createdAt: now }, connections: [connection] }, connection };
};
const own = asAgentRow(77, false);
check("web-sealed secret decrypts in the agent (credentialFor)", (await credentialFor(own.resolved, own.connection, "env-demo-token")) === token);
const moved = asAgentRow(78, false);
check("the same ciphertext copied to another workspace's row fails", await credentialFor(moved.resolved, moved.connection, undefined).then(() => false, () => true));
const empty = { ...asAgentRow(79, false), connection: { ...own.connection, workspaceId: 79, secretCiphertext: null } };
check("a user workspace never falls back to the env demo token", (await credentialFor(empty.resolved, empty.connection, "env-demo-token")) === null);
const demo = { ...asAgentRow(1, true), connection: { ...own.connection, workspaceId: 1, secretCiphertext: null } };
check("the demo workspace uses the env token", (await credentialFor(demo.resolved, demo.connection, "env-demo-token")) === "env-demo-token");
check("service module loads against the shared helper", typeof service.saveSentry === "function");

// ---- GitHub: the signed-in user must be able to reach the installation --------------------
const { githubConnectEnabled, userCanAccessInstallation } = await import("../apps/web/lib/connections/github-user");
const savedFlag = process.env.GITHUB_CONNECT_ENABLED;
delete process.env.GITHUB_CONNECT_ENABLED;
check("GitHub connect is off unless GITHUB_CONNECT_ENABLED=1", githubConnectEnabled() === false);
process.env.GITHUB_CONNECT_ENABLED = "1";
check("…and on with GITHUB_CONNECT_ENABLED=1", githubConnectEnabled() === true);
if (savedFlag === undefined) delete process.env.GITHUB_CONNECT_ENABLED;
else process.env.GITHUB_CONNECT_ENABLED = savedFlag;
const fakeGithub = (pages: number[][], status = 200): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname !== "/user/installations") throw new Error(`unexpected ${url.pathname}`);
    if (!String((init?.headers as Record<string, string>)?.Authorization).startsWith("Bearer ")) throw new Error("no bearer");
    const ids = pages[Number(url.searchParams.get("page")) - 1] ?? [];
    return new Response(JSON.stringify({ total_count: pages.flat().length, installations: ids.map((id) => ({ id })) }), { status });
  }) as typeof fetch;
check("installation the user can access is accepted", (await userCanAccessInstallation("ghu_x", "171490641", fakeGithub([[5, 171490641]]))).ok);
const page2 = Array.from({ length: 100 }, (_, i) => i + 1);
check("…found on a later page too", (await userCanAccessInstallation("ghu_x", "4242", fakeGithub([page2, [4242]]))).ok);
const foreign = await userCanAccessInstallation("ghu_x", "999", fakeGithub([[5, 171490641]]));
check("someone else's installation id (typed into the URL) is refused", !foreign.ok && foreign.code === "not_your_installation");
const expiredUser = await userCanAccessInstallation("ghu_x", "5", fakeGithub([[5]], 401));
check("a rejected user token is refused", !expiredUser.ok && expiredUser.code === "user_token_invalid");
const notAnId = await userCanAccessInstallation("ghu_x", "1 OR 1=1", fakeGithub([[1]]));
check("a non-numeric installation id is refused before any request", !notAnId.ok && notAnId.code === "bad_input");

if (saved === undefined) delete process.env.CONNECTIONS_ENCRYPTION_KEY;
else process.env.CONNECTIONS_ENCRYPTION_KEY = saved;

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
