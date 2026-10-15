// Prints the exact clicks for a manual end-to-end test of "Connect your repos" (GitHub) on a
// deployment, and checks what can be checked without a session. Read-only: it never changes the
// GitHub App, Vercel env or the database.
//
//   npx tsx scripts/github-connect-smoke.ts                       # preview of santiago/github-connect-ready
//   npx tsx scripts/github-connect-smoke.ts https://<preview-host>
//   npx tsx scripts/github-connect-smoke.ts --branch <git-branch>
//
// Preview deployments may sit behind Vercel Deployment Protection; the checks then report 401
// from Vercel (not from Roary). Open the URLs in a browser signed in to Vercel instead.

export {};

const APP_SLUG =process.env.GITHUB_APP_SLUG ?? "myroary";
const APP_ID = "5320987";
const PRODUCTION = "https://roary-rho.vercel.app";

function baseUrl(): string {
  const args = process.argv.slice(2);
  const branchAt = args.indexOf("--branch");
  if (branchAt >= 0) {
    const branch = args[branchAt + 1] ?? "";
    // Vercel's branch alias. Labels over 63 chars get shortened by Vercel; pass the URL from the PR then.
    const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `https://roary-git-${slug}-roary-hack.vercel.app`;
  }
  const url = args.find((a) => a.startsWith("http"));
  return (url ?? "https://roary-git-santiago-github-connect-ready-roary-hack.vercel.app").replace(/\/+$/, "");
}

async function probe(url: string): Promise<{ status: number; body: Record<string, unknown> | null; vercelGate: boolean }> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    const vercelGate = response.status === 401 && (text.includes("Vercel Authentication") || response.headers.has("x-vercel-sso") || !body);
    return { status: response.status, body, vercelGate };
  } catch (error) {
    return { status: 0, body: { error: error instanceof Error ? error.name : "unknown" }, vercelGate: false };
  }
}

const base = baseUrl();
const isProd = base === PRODUCTION;
const callback = `${base}/api/connect/github/callback`;

console.log(`\nGitHub connect smoke test for ${base}${isProd ? "  (PRODUCTION)" : ""}\n`);

const health = await probe(`${base}/eve/v1/health`);
const stack = await probe(`${base}/api/connections`);
const flag = stack.body && typeof stack.body.githubEnabled === "boolean" ? (stack.body.githubEnabled as boolean) : undefined;

console.log("Checks (no session):");
console.log(`  /eve/v1/health        ${health.status}${health.vercelGate ? "  (Vercel Deployment Protection: open it in a browser signed in to Vercel)" : ""}`);
console.log(`  /api/connections      ${stack.status}  githubEnabled=${flag === undefined ? "unknown" : String(flag)}`);
if (flag === false) {
  console.log(`\n  GITHUB_CONNECT_ENABLED is off on this deployment. Set it for this environment and redeploy:`);
  console.log(`    vercel env add GITHUB_CONNECT_ENABLED ${isProd ? "production" : "preview"}   # value: 1`);
}

console.log(`
Human steps (passkey / OAuth consent; an agent must not do these):

  1. GitHub App settings → https://github.com/settings/apps/${APP_SLUG}  (App id ${APP_ID}; if the App is
     owned by an org: https://github.com/organizations/<org>/settings/apps/${APP_SLUG})
       Setup URL (optional)   = ${callback}
       [x] Redirect on update
     The App has ONE Setup URL. After a preview test, set it back to
       ${PRODUCTION}/api/connect/github/callback

  2. Sign in to Roary:            ${base}/hire   (account menu → Sign in)
  3. Open connections:            ${base}/settings/connections
     The GitHub card must show "Install the GitHub App" next to "Quick connect".
  4. Click it (or open directly): ${base}/api/connect/github/install
     → github.com/apps/${APP_SLUG}/installations/new → pick an account + "Only select repositories".
  5. GitHub redirects to the callback. The first time, Vercel Connect sends you to GitHub's
     "Authorize ${APP_SLUG}" OAuth screen → click Authorize. You land back on the callback.
  6. Expect ${base}/settings/connections?github=connected
     and the card: "✅ Connected · N repos · owner/repo".
     Errors show as ?github=error&detail=<code>:
       claimed                → that installation already belongs to another workspace (unique index)
       not_your_installation  → your GitHub user can't access that installation
       state_browser/expired  → start again from step 4 in the same browser

  Lifecycle webhooks (POST ${base}/eve/v1/github, forwarded by Vercel Connect):
  7. On GitHub → Settings → Applications → ${APP_SLUG} → Configure: remove one repo → Save.
     Reload ${base}/settings/connections: that repo is gone from the card.
     Add it back → it reappears.
  8. Suspend the installation → card "❌ Needs attention"; Unsuspend → "✅ Connected".
  9. Uninstall → card "❌ Uninstalled". Installing again (step 4) reconnects with the new id.
     If a step doesn't update the card, check Vercel logs for "github lifecycle" and the App's
     Advanced → Recent Deliveries (Connect must forward installation events to this deployment).
`);
