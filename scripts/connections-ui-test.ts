// HTTP smoke test for the "connect your stack" pages and API against a running web app.
//   npx next dev apps/web -p 3101          (in another terminal)
//   npx tsx --env-file=.env.local scripts/connections-ui-test.ts
// BASE defaults to http://localhost:3101. MODE=guest (default) checks the signed-out
// experience; MODE=member expects the server to run with CONNECTIONS_DEV_WORKSPACE_ID
// (dev-only stand-in for a signed-in user) and exercises connect + test for real.

const BASE = process.env.BASE ?? "http://localhost:3101";
const MODE = process.env.MODE ?? "guest";

let failures = 0;
const expect = (name: string, ok: boolean, note = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
};

async function page(path: string) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: response.status, html: await response.text(), location: response.headers.get("location") };
}
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown>, headers: response.headers };
}
const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const settings = await page("/settings/connections");
expect("GET /settings/connections renders", settings.status === 200 && settings.html.includes("Connect your stack"), String(settings.status));
const hire = await page("/hire");
expect("GET /hire renders with the Stack station in the nav", hire.status === 200 && hire.html.includes("Stack"), String(hire.status));
const notice = await page("/settings/connections?github=connected");
expect("GitHub outcome notice renders", notice.html.includes("GitHub connected"));

const list = await api("/api/connections");
expect("GET /api/connections answers JSON", list.status === 200 && typeof list.body.connections === "object", String(list.status));
expect("…and never includes ciphertext", !JSON.stringify(list.body).includes("secretCiphertext"));

if (MODE === "guest") {
  expect("guest is not signed in", list.body.signedIn === false);
  expect("guest can't connect Sentry (401)", (await post("/api/connections/sentry", { token: "x".repeat(20), org: "a", project: "b" })).status === 401);
  expect("guest can't test (401)", (await post("/api/connections/posthog/test")).status === 401);
  const install = await api("/api/connect/github/install");
  expect("guest GitHub install bounces to sign-in", install.status === 307 && (install.headers.get("location") ?? "").includes("github=signin"));
} else {
  expect("member is signed in", list.body.signedIn === true, `store=${list.body.store}`);
  const install = await api("/api/connect/github/install");
  const location = install.headers.get("location") ?? "";
  const cookie = install.headers.get("set-cookie") ?? "";
  expect(
    "GitHub install redirects to myroary with a signed state + nonce cookie",
    install.status === 307 && location.startsWith("https://github.com/apps/myroary/installations/new?state=") && cookie.includes("roary_gh_install="),
  );
  const state = new URL(location).searchParams.get("state") ?? "";
  const nonce = /roary_gh_install=([^;]+)/.exec(cookie)?.[1] ?? "";

  const forged = await api(`/api/connect/github/callback?installation_id=1&setup_action=install&state=${encodeURIComponent(state)}`);
  expect("callback without the nonce cookie is refused", (forged.headers.get("location") ?? "").includes("state_browser"));

  const installationId = process.env.GITHUB_TEST_INSTALLATION_ID;
  if (installationId) {
    const cb = await api(`/api/connect/github/callback?installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `roary_gh_install=${nonce}` },
    });
    expect("callback with state + cookie verifies the installation via Connect", (cb.headers.get("location") ?? "").includes("github=connected"), cb.headers.get("location") ?? "");
  } else {
    const bogus = await api(`/api/connect/github/callback?installation_id=1&setup_action=install&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `roary_gh_install=${nonce}` },
    });
    expect("callback refuses an installation that isn't myroary's", (bogus.headers.get("location") ?? "").includes("not_installed"), bogus.headers.get("location") ?? "");
  }

  if (process.env.SENTRY_AUTH_TOKEN) {
    const sentry = await post("/api/connections/sentry", { token: process.env.SENTRY_AUTH_TOKEN, org: "roary", project: "javascript-nextjs-k4" });
    expect("connect Sentry with the demo token", sentry.status === 200, `${sentry.status} via ${sentry.body.checkedVia ?? sentry.body.error}`);
    const test = await post("/api/connections/sentry/test");
    expect("Test Sentry", test.body.ok === true);
  }
  if (process.env.POSTHOG_API_KEY) {
    const posthog = await post("/api/connections/posthog", { apiKey: process.env.POSTHOG_API_KEY, projectId: "665339", region: "us" });
    expect("connect PostHog with the demo key", posthog.status === 200, String(posthog.status));
    const wrong = await post("/api/connections/posthog", { apiKey: process.env.POSTHOG_API_KEY, projectId: "665339", region: "eu" });
    expect("wrong region is a 422 with a readable error", wrong.status === 422 && typeof wrong.body.error === "string");
  }
  const after = await api("/api/connections");
  const connections = after.body.connections as Record<string, { status?: string } | null>;
  console.log("      statuses:", Object.fromEntries(Object.entries(connections).map(([k, v]) => [k, v?.status ?? "none"])));
  expect("…and the listing still never includes secrets", !JSON.stringify(after.body).includes("secretCiphertext") &&
    !(process.env.SENTRY_AUTH_TOKEN && JSON.stringify(after.body).includes(process.env.SENTRY_AUTH_TOKEN)));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

export {};
