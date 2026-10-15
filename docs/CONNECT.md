# Connect your stack (per-workspace GitHub, Sentry, PostHog)

A signed-in team points Roary at **their own** Sentry project and PostHog project (GitHub is
behind a flag, see below) instead of the demo shop. Guests keep the demo shop exactly as before.
UI: the **Stack** station in `/hire` (guests can skip it with "Use the demo shop →") and
`/settings/connections`. A signed-in user with nothing connected sees a "Connect your stack" card
on `/desk` instead of an empty feed.

## How a turn finds its credentials

```
browser (Neon Auth session) ──JWT──▶ eve channel: neonAuth() verifies (JWKS) → principal {neon-auth, user id}
                                                        │
GitHub webhook ──▶ eve github channel: principal {github-webhook, installation_id}
Sentry webhook / anonymous / localDev ──▶ principal without a workspace of its own
                                                        ▼
                       resolveWorkspace(principal)  (agent/lib/workspace.ts)
                         neon user        → their workspace (created on first touch)
                         github-webhook   → workspace whose github connection has that installationId, else demo
                         anything else    → the demo workspace ("Roary Demo Shop", is_demo)
                                                        ▼
                       credentialFor(resolved, connection, envToken)
                         1. connection.secret_ciphertext → decrypt (agent/lib/crypto.ts, AAD = workspace:provider)
                         2. connection.connector_ref     → Vercel Connect app token (GitHub: pinned to installationId)
                         3. demo workspace only          → env token (SENTRY_AUTH_TOKEN / POSTHOG_API_KEY)
```

A signed-in workspace **never** falls back to the demo's env tokens.

## Code map

| Piece | File |
|---|---|
| Tables (`workspaces`, `workspace_members`, `connections`) | `agent/lib/schema.ts`, migration `drizzle/0003_workspaces.sql` |
| Workspace resolution + credential choice | `agent/lib/workspace.ts` (`resolveWorkspace`, `credentialFor`) |
| Per-turn helpers, `[Workspace]` context line | `agent/lib/workspace-context.ts`, `agent/lib/sentry-access.ts` |
| **The one encryption helper** (both sides) | `agent/lib/crypto.ts` |
| Neon Auth JWT verification in eve | `agent/lib/neon-auth.ts`, `agent/channels/eve.ts` |
| Agent consumers | `agent/tools/{list,get}_sentry_issue.ts`, `agent/connections/posthog.ts` (per-caller `auth`), `agent/extensions/github.ts` (per-caller `connect`) |
| Web: caller's workspace | `apps/web/lib/connections/workspace.ts` (`getUserWorkspace`, `getCurrentWorkspace` → `resolveWorkspace`) |
| Web: repository over `connections` | `apps/web/lib/connections/store.ts` (memory store only with `CONNECTIONS_STORE=memory` or no `DATABASE_URL` outside production) |
| Live validators | `apps/web/lib/connections/validate.ts` |
| Validate → encrypt → store | `apps/web/lib/connections/service.ts` |
| GitHub install state / user ownership check | `apps/web/lib/connections/github-state.ts`, `apps/web/lib/connections/github-user.ts` |
| GitHub claim uniqueness | index `connections_github_installation_unique` (`drizzle/0004_github_installation_unique.sql`), `InstallationClaimedError` in `store.ts` |
| GitHub lifecycle webhooks | `agent/lib/github-lifecycle.ts`, wrapped route in `agent/channels/github.ts` |
| API | `GET /api/connections` (401 for guests), `POST /api/connections/{sentry,posthog}`, `POST /api/connections/{provider}/test`, `/api/connect/github/install`, `/api/connect/github/callback` |
| Cards | `apps/web/app/_components/connect-stack.tsx` |
| Desk CTA | `apps/web/app/desk/_components/activity-feed.tsx` (reads `workspace` from `/api/feed`) |

Secrets never leave the server: GET returns `hasSecret`, never the ciphertext.

## Encryption

AES-256-GCM, key = HKDF-SHA256(`CONNECTIONS_ENCRYPTION_KEY`, info `roary:connections-secret`).
Format `v1.<iv>.<tag>.<ciphertext>` (base64url). Additional data = `<workspaceId>:<provider>`, so a
ciphertext copied into another workspace's row fails to decrypt. The web app writes with
`sealConnectionSecret(workspaceId, provider, token)`; the agent reads with `openConnectionSecret(row)`.
The same key must be set for the web app and the agent (same Vercel project, so one env var).
Rotating the key makes stored secrets unreadable: the card's Test button then says "Connect again".

## GitHub (App `myroary`, via Vercel Connect `github/roary`) — behind `GITHUB_CONNECT_ENABLED=1`

1. **Install** → `/api/connect/github/install` signs `state = {workspaceId, nonce, exp}` (HMAC,
   15 min), sets the nonce in an httpOnly cookie, redirects to `github.com/apps/myroary/installations/new`.
2. **Callback** `/api/connect/github/callback?installation_id&setup_action&state` checks the
   signature, expiry, cookie nonce, and that the state's workspace is the signed-in user's.
3. **Ownership proof** (the fix for "the callback trusted `installation_id` from the query string"):
   the callback gets the person's GitHub **user** token from Vercel Connect
   (`getToken("github/roary", {subject: {type: "user", id: <neon user id>, issuer: <neon auth origin>}})`).
   Without one it redirects to `startAuthorization(...)` and Connect brings them back to the same
   callback URL. The installation must appear in `GET /user/installations`, otherwise nothing is saved.
4. **Verify + store**: an app installation token from Connect lists `config.repos`; the row stores
   `{installationId, repos}` with `connector_ref = 'github/roary'` and no secret.
   **First claim wins, atomically:** the partial unique index `connections_github_installation_unique`
   on `(config->>'installationId') WHERE provider = 'github' AND installationId <> ''`
   (`drizzle/0004_github_installation_unique.sql`) rejects a second workspace's upsert with 23505;
   the store turns that into `InstallationClaimedError` and the callback into
   `?github=error&detail=claimed` ("already connected to another Roary workspace"). The read before
   it is only the friendly fast path. Pending rows (`installationId: ""`) and the demo row are excluded.
5. **Agent**: the GitHub extension's per-caller `connect` resolver pins tool calls to that
   installation and its repos for a signed-in workspace; the demo keeps the app default. Any status
   other than `connected` (`error`, `disconnected`, `pending`) blocks GitHub tools for that workspace.
6. **Webhooks**: `@roary` mentions / PR events carry `installation_id`; `resolveWorkspace` routes
   them to the workspace that connected that installation. Unclaimed installs (the demo shop) → demo.
7. **Lifecycle webhooks** (`agent/lib/github-lifecycle.ts`, wired in `agent/channels/github.ts`).
   eve's `githubChannel` ignores App lifecycle events, so the channel's `POST /eve/v1/github` route is
   wrapped: `installation` / `installation_repositories` deliveries are verified with the same Connect
   verifier (Vercel OIDC) and routed by `payload.installation.id`; every other event goes to eve with
   the body untouched. Under `SELECT … FOR UPDATE`:

   | Event | Effect on that workspace's `github` row |
   |---|---|
   | `installation.deleted` | `status = 'disconnected'` (id kept; GitHub never reuses ids, a reinstall is claimed again) |
   | `installation.suspend` | `status = 'error'` |
   | `installation.unsuspend` | `error` → `connected` (never resurrects `disconnected`) |
   | `installation_repositories` (added/removed) | `config.repos` minus removed plus added (set-based, retry-safe) |
   | `installation.created`, unclaimed installation ids | ignored (ownership is proven by the callback) |

   Unverified → 401. A database error → 500 so GitHub's "Recent Deliveries" can redeliver.
   **Unverified in production:** that Vercel Connect forwards `installation*` events to the trigger
   destination like it does `issue_comment`. Step 7–9 of the checklist below proves it.

### The flag is per environment

`githubConnectEnabled()` reads `GITHUB_CONNECT_ENABLED` (`1` or `true`) from `process.env` on every
request (`/api/connections` and the connect routes are dynamic), so Vercel's env scopes are the
switch: set it on **Preview** first, **Production** only after the checklist passes. Production stays
off (the card says "Coming soon") until someone adds the var there and redeploys.
`npx tsx scripts/github-connect-smoke.ts [<deployment url> | --branch <git branch>]` reports the flag
for a deployment (from the guest 401 body of `/api/connections`) and prints the exact URLs below.

### Human checklist to turn GitHub on (needs a passkey / OAuth consent — agents must not do these)

1. **Preview env:** `vercel env add GITHUB_CONNECT_ENABLED preview` → `1`, then redeploy the preview
   (push a commit or `vercel redeploy <preview url>`). Run the smoke script: `githubEnabled=true`.
2. **GitHub App Setup URL** (github.com → Settings → Developer settings → GitHub Apps → `myroary`,
   App id 5320987 → General): *Setup URL* = `https://<preview host>/api/connect/github/callback`,
   tick **Redirect on update**, Save (GitHub asks for your passkey). The App has one Setup URL, so
   this temporarily points installs at the preview.
3. Open `https://<preview host>/hire`, sign in (Neon Auth), go to `/settings/connections`. The GitHub
   card must say **Install Roary on your repos** (not "Coming soon").
4. Click it → GitHub's install page → choose the account, **Only select repositories**, pick 1–2 → Install.
5. First time only: Vercel Connect sends you to GitHub's **Authorize myroary** OAuth screen → **Authorize**.
   (If Connect refuses the preview host as a return URL, allow it in the Connect connector `github/roary`
   settings and retry; this is the one Connect behaviour not yet seen live.)
6. You land on `/settings/connections?github=connected`; the card shows **✅ Connected · N repos**.
   Try a second Roary account with the same installation: it must get "already connected to another
   Roary workspace".
7. On GitHub → Settings → Applications → myroary → **Configure**: remove a repo, Save → reload the card,
   the repo is gone. Add it back → it returns. (No change? Check Vercel logs for `github lifecycle` and
   the App's Advanced → Recent Deliveries.)
8. Suspend the installation → card **❌ Needs attention**; Unsuspend → **✅ Connected**.
9. Comment `@roary hi` on an issue in a connected repo → Roary answers in that workspace's context.
10. **Production:** set the Setup URL to `https://roary-rho.vercel.app/api/connect/github/callback`
    (Redirect on update on), `vercel env add GITHUB_CONNECT_ENABLED production` → `1`, redeploy, and
    repeat steps 3–6 on production. Roll back by removing the env var and redeploying: new installs
    stop (the install/callback routes answer "unavailable"); already connected workspaces keep working.

## Sentry

- Paste an auth token + org + project. Validation calls `GET /api/0/projects/{org}/{project}/`; on
  403 (no `project:read`, true of the demo "Roary" internal integration) it falls back to
  `GET …/issues/?limit=1`, the scope triage needs. Stored encrypted.
- Self-hosted Sentry and non-US region hosts aren't supported yet.
- **Sentry webhook stays demo-only**: `agent/channels/sentry-webhook.ts` verifies one shared
  client secret (`SENTRY_WEBHOOK_SECRET`) of the demo's internal integration, so every alert it
  receives is the demo's. Routing a team's alerts needs a Sentry *public* integration (publish
  request + Sentry review, redirect URL, webhook URL, client secret); its `installation.uuid` would
  then map to a workspace the same way GitHub's `installation_id` does. A team's own Sentry still
  works for chat-time triage today.

## PostHog

Personal API key (scope preset "MCP Server") + project id + US/EU cloud. Validation:
`GET {host}/api/projects/{id}/`. Only `us.posthog.com` / `eu.posthog.com` are accepted (no SSRF).
The wrong region answers 401, and the UI says so. Stored encrypted; the PostHog MCP connection
picks it per turn.

## Env

| Name | Where | Notes |
|---|---|---|
| `CONNECTIONS_ENCRYPTION_KEY` | web + agent | 32 bytes, base64 or hex (`openssl rand -base64 32`). Without it, connect routes answer 503. |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | web + agent | Sign-in (web) and JWT verification (eve). |
| `DATABASE_URL` | web + agent | The `connections` table. |
| `VERCEL_OIDC_TOKEN` | automatic on Vercel | Connect tokens for `github/roary`; local: `vercel env pull`. |
| `GITHUB_CONNECT_ENABLED=1` | optional, per Vercel environment | `1`/`true` shows the GitHub connect button and enables the install/callback routes. Read per request; set on Preview first. |
| `CONNECTIONS_STORE=memory` | tests only | In-memory store. |
| `GITHUB_CONNECTOR`, `GITHUB_APP_SLUG` | optional | Default `github/roary`, `myroary`. |

## Tests

```bash
npx tsx scripts/connections-crypto-test.ts                               # no network: crypto, web→agent decrypt, GitHub ownership check
npx tsx --env-file=.env.local scripts/connections-providers-test.ts      # live Sentry, PostHog, GitHub via Connect (memory store)
npx tsx scripts/github-connect-test.ts                                   # flag, claim rules, lifecycle webhooks (synthetic payloads)
npx tsx --env-file=.env.devconnect scripts/github-connect-test.ts       # + concurrent claim race and lifecycle on Postgres (non-production branch, 0004 applied)
npx tsx scripts/github-connect-smoke.ts <deployment url>                 # flag state + the URLs to click for the manual test
# On a NON-production Neon branch (env with NEON_BRANCH != production, NEON_AUTH_*):
npx eve dev --no-ui & npx next dev apps/web -p 3101 &
npx tsx --env-file=<that env> scripts/test-workspaces.ts                # a–d, d = full web → agent round trip
npx tsx --env-file=<that env> scripts/connections-ui-test.ts            # guest; MODE=member for a signed-in user
```
