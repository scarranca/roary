// Live checks for the "connect your stack" validators and the validate → encrypt → store
// flow, using the demo credentials already in .env.local. Never prints a secret.
// Run: npx tsx --env-file=.env.local scripts/connections-providers-test.ts
//   needs SENTRY_AUTH_TOKEN, POSTHOG_API_KEY; GitHub checks need VERCEL_OIDC_TOKEN (skipped without).
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_STORE = "memory"; // never touch the real database from a test
process.env.CONNECTIONS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { validateSentry, validatePosthog, verifyGithubInstallation, POSTHOG_HOSTS } = await import(
  "../apps/web/lib/connections/validate"
);
const service = await import("../apps/web/lib/connections/service");
const { getConnectionStore } = await import("../apps/web/lib/connections/store");

const DEMO = { sentry: { org: "roary", project: "javascript-nextjs-k4" }, posthog: { projectId: "665339", host: POSTHOG_HOSTS.us } };

let failures = 0;
const report = (status: "PASS" | "FAIL" | "SKIP", name: string, note = "") => {
  if (status === "FAIL") failures++;
  console.log(`${status}  ${name}${note ? `  (${note})` : ""}`);
};
const expect = (name: string, ok: boolean, note?: string) => report(ok ? "PASS" : "FAIL", name, note);

const sentryToken = process.env.SENTRY_AUTH_TOKEN;
const posthogKey = process.env.POSTHOG_API_KEY;

// ---- Sentry ---------------------------------------------------------------
if (!sentryToken) report("SKIP", "Sentry: SENTRY_AUTH_TOKEN not set");
else {
  const good = await validateSentry(sentryToken, DEMO.sentry);
  expect("Sentry: demo token validates for roary/javascript-nextjs-k4", good.ok, good.ok ? `checked via ${good.checkedVia}` : good.message);
  if (good.ok && good.checkedVia !== "project") {
    console.log("      note: GET /projects/roary/javascript-nextjs-k4/ answered 403 (token lacks project:read); issues endpoint passed");
  }
  const wrongProject = await validateSentry(sentryToken, { org: "roary", project: "does-not-exist-404" });
  expect("Sentry: unknown project is refused", !wrongProject.ok, wrongProject.ok ? "accepted!" : wrongProject.code);
}
const badSentry = await validateSentry("not-a-real-token-000000", DEMO.sentry);
expect("Sentry: bad token is refused as unauthorized", !badSentry.ok && badSentry.code === "unauthorized", badSentry.ok ? "accepted!" : badSentry.code);
const badSlug = await validateSentry("x".repeat(20), { org: "../etc", project: "p" });
expect("Sentry: non-slug org rejected before any request", !badSlug.ok && badSlug.code === "bad_input");

// ---- PostHog --------------------------------------------------------------
if (!posthogKey) report("SKIP", "PostHog: POSTHOG_API_KEY not set");
else {
  const good = await validatePosthog(posthogKey, DEMO.posthog);
  expect("PostHog: demo key validates for project 665339 (US)", good.ok, good.ok ? `project "${good.detail.name}"` : good.message);
  const wrongRegion = await validatePosthog(posthogKey, { ...DEMO.posthog, host: POSTHOG_HOSTS.eu });
  expect("PostHog: wrong region (EU) is refused", !wrongRegion.ok, wrongRegion.ok ? "accepted!" : wrongRegion.code);
}
const badPosthog = await validatePosthog("phx_not_a_real_key_000", DEMO.posthog);
expect("PostHog: bad key is refused as unauthorized", !badPosthog.ok && badPosthog.code === "unauthorized", badPosthog.ok ? "accepted!" : badPosthog.code);
const evilHost = await validatePosthog("phx_x_000000000", { projectId: "1", host: "https://evil.example" });
expect("PostHog: hosts outside US/EU cloud are rejected (no SSRF)", !evilHost.ok && evilHost.code === "bad_input");

// ---- GitHub (Vercel Connect github/roary = myroary App) --------------------
if (!process.env.VERCEL_OIDC_TOKEN) report("SKIP", "GitHub: VERCEL_OIDC_TOKEN not set");
else {
  const { getTokenResponse } = await import("@vercel/connect");
  let knownId: string | undefined;
  try {
    knownId = (await getTokenResponse("github/roary", { subject: { type: "app" } })).installationId;
  } catch (error) {
    report("FAIL", "GitHub: Connect app token for github/roary", (error as Error).message.slice(0, 120));
  }
  if (knownId) {
    const ok = await verifyGithubInstallation(knownId);
    expect(`GitHub: existing installation ${knownId} verifies via Connect`, ok.ok, ok.ok ? `${ok.detail.total} repos visible` : ok.message);
  }
  const bogus = await verifyGithubInstallation("1");
  expect("GitHub: installation id that isn't myroary's is refused", !bogus.ok && bogus.code === "not_installed", bogus.ok ? "accepted!" : bogus.code);

  // The ownership check's first leg: a user with no GitHub authorization yet is sent to Connect's
  // GitHub OAuth screen (the second leg, /user/installations, needs a human to finish OAuth).
  const { githubUserToken } = await import("../apps/web/lib/connections/github-user");
  try {
    const user = await githubUserToken(`roary-test-${Date.now()}`, "http://localhost:3101/api/connect/github/callback");
    expect(
      "GitHub: unauthorized user gets a Connect authorize URL (user subject)",
      user.kind === "authorize" && new URL(user.url).host === "connect.vercel.com",
      user.kind === "authorize" ? new URL(user.url).host : "got a token for a brand-new user?!",
    );
  } catch (error) {
    report("FAIL", "GitHub: Connect user authorization", (error as Error).message.slice(0, 120));
  }
}

// ---- Full flow: validate → encrypt → store → test (memory store) -----------
const store = await getConnectionStore();
expect("Store: memory fallback in use for tests", store.kind === "memory");
const workspaceId = 9001;
if (sentryToken) {
  const saved = await service.saveSentry(workspaceId, { token: sentryToken, ...DEMO.sentry });
  const row = await store.get(workspaceId, "sentry");
  expect(
    "Flow: Sentry saved encrypted (ciphertext ≠ token, not exposed publicly)",
    saved.ok && !!row?.secretCiphertext && !row.secretCiphertext.includes(sentryToken) && !("secretCiphertext" in (saved.ok ? saved.connection : {})),
  );
  const tested = await service.testConnection(workspaceId, "sentry");
  expect("Flow: Sentry Test re-validates with the decrypted token", tested.ok, tested.ok ? tested.checkedVia : tested.message);
}
if (posthogKey) {
  const saved = await service.savePosthog(workspaceId, { apiKey: posthogKey, ...DEMO.posthog });
  expect("Flow: PostHog saved", saved.ok && (await store.get(workspaceId, "posthog"))?.status === "connected");
  const tested = await service.testConnection(workspaceId, "posthog");
  expect("Flow: PostHog Test re-validates", tested.ok);
}
const refused = await service.saveSentry(workspaceId + 1, { token: "not-a-real-token-000000", ...DEMO.sentry });
expect("Flow: a failed check stores nothing", !refused.ok && (await store.get(workspaceId + 1, "sentry")) === null);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
