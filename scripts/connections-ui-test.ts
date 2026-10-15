// HTTP smoke test for the "connect your stack" pages and API against a running web app.
//   npx next dev apps/web -p 3101          (in another terminal, on a NON-production Neon branch)
//   npx tsx --env-file=.env.local scripts/connections-ui-test.ts
// BASE defaults to http://localhost:3101. MODE=guest (default) checks the signed-out experience;
// MODE=member signs up a throwaway Neon Auth user through the app's /api/auth proxy and saves
// real connections (the full agent round trip lives in scripts/test-workspaces.ts, case d).

const BASE = process.env.BASE ?? "http://localhost:3101";
const MODE = process.env.MODE ?? "guest";

if (MODE === "member" && (process.env.NEON_BRANCH === "production" || !process.env.NEON_BRANCH)) {
  console.error("Refusing to run member mode against production (NEON_BRANCH).");
  process.exit(2);
}

let failures = 0;
const expect = (name: string, ok: boolean, note = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
};

let cookie = "";
async function page(path: string) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: response.status, html: await response.text(), location: response.headers.get("location") };
}
async function api(path: string, init: RequestInit = {}) {
  const headers = { origin: BASE, ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) };
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init, headers });
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

if (MODE === "guest") {
  const list = await api("/api/connections");
  expect("guest GET /api/connections is 401 and says signedIn=false", list.status === 401 && list.body.signedIn === false, String(list.status));
  expect("guest can't connect Sentry (401)", (await post("/api/connections/sentry", { token: "x".repeat(20), org: "a", project: "b" })).status === 401);
  expect("guest can't test (401)", (await post("/api/connections/posthog/test")).status === 401);
  const install = await api("/api/connect/github/install");
  const location = install.headers.get("location") ?? "";
  expect(
    "guest GitHub install bounces (sign-in, or unavailable while GITHUB_CONNECT_ENABLED is off)",
    install.status === 307 && (location.includes("github=signin") || location.includes("github=unavailable")),
    location.replace(BASE, ""),
  );
  const feed = await api("/api/feed");
  expect("guest feed is the demo workspace", feed.status === 200 && (feed.body.workspace as { isDemo?: boolean })?.isDemo === true);
} else {
  const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: `roary-ui-${Date.now()}@example.com`, password: `${crypto.randomUUID()}Aa1!`, name: "Roary UI test" }),
  });
  cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect("sign up through /api/auth", signUp.ok && cookie.length > 0, String(signUp.status));

  const list = await api("/api/connections");
  expect("member is signed in with an empty stack", list.status === 200 && list.body.signedIn === true, `store=${list.body.store}`);
  const feed = await api("/api/feed");
  const ws = feed.body.workspace as { signedIn?: boolean; connected?: string[] } | undefined;
  expect("member feed says: own workspace, nothing connected (desk shows the CTA)", ws?.signedIn === true && ws.connected?.length === 0);

  const install = await api("/api/connect/github/install");
  const location = install.headers.get("location") ?? "";
  if (list.body.githubEnabled) {
    expect("GitHub install redirects to myroary with a signed state", install.status === 307 && location.startsWith("https://github.com/apps/myroary/installations/new?state="));
  } else {
    expect("GitHub connect stays hidden: install answers 'unavailable'", install.status === 307 && location.includes("github=unavailable"));
    const cb = await api("/api/connect/github/callback?installation_id=171490641&setup_action=install&state=x");
    expect("…and the callback binds nothing", (cb.headers.get("location") ?? "").includes("github=unavailable"));
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
  expect(
    "…and the listing never includes secrets",
    !JSON.stringify(after.body).includes("secretCiphertext") &&
      !(process.env.SENTRY_AUTH_TOKEN && JSON.stringify(after.body).includes(process.env.SENTRY_AUTH_TOKEN)),
  );
  console.log("      (throwaway workspace left on this branch; scripts/test-workspaces.ts cleans up its own)");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

export {};
