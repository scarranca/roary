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
   `{installationId, repos}` with `connector_ref = 'github/roary'` and no secret. First claim wins.
5. **Agent**: the GitHub extension's per-caller `connect` resolver pins tool calls to that
   installation and its repos for a signed-in workspace; the demo keeps the app default.
6. **Webhooks**: `@roary` mentions / PR events carry `installation_id`; `resolveWorkspace` routes
   them to the workspace that connected that installation. Unclaimed installs (the demo shop) → demo.

**Why it's off in production:** steps 3–4 can't be verified end to end without a person clicking
through GitHub's OAuth screen, and the App's *Setup URL* must be set to
`https://<host>/api/connect/github/callback` ("Redirect on update" on) — a production App setting
that wasn't changed. Unit tests cover the ownership check (`scripts/connections-crypto-test.ts`) and
the live test confirms Connect starts user authorization for `github/roary`
(`scripts/connections-providers-test.ts`). To turn it on: set the Setup URL, set
`GITHUB_CONNECT_ENABLED=1` on a preview, connect a real install, then enable in production.
Not done yet: handling `installation.deleted` / `installation_repositories` events to update rows.

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
| `GITHUB_CONNECT_ENABLED=1` | optional | Shows the GitHub connect button and enables the install/callback routes. |
| `CONNECTIONS_STORE=memory` | tests only | In-memory store. |
| `GITHUB_CONNECTOR`, `GITHUB_APP_SLUG` | optional | Default `github/roary`, `myroary`. |

## Tests

```bash
npx tsx scripts/connections-crypto-test.ts                               # no network: crypto, web→agent decrypt, GitHub ownership check
npx tsx --env-file=.env.local scripts/connections-providers-test.ts      # live Sentry, PostHog, GitHub via Connect (memory store)
# On a NON-production Neon branch (env with NEON_BRANCH != production, NEON_AUTH_*):
npx eve dev --no-ui & npx next dev apps/web -p 3101 &
npx tsx --env-file=<that env> scripts/test-workspaces.ts                # a–d, d = full web → agent round trip
npx tsx --env-file=<that env> scripts/connections-ui-test.ts            # guest; MODE=member for a signed-in user
```
