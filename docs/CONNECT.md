# Connect your stack (per-workspace GitHub, Sentry, PostHog)

Lets a signed-in team point Roary at **their own** repos, Sentry project and PostHog project
instead of the demo shop. UI: the **Stack** station in `/hire` (between Jobs and Offer) and
`/settings/connections`. Guests see the demo shop's stack and a sign-in prompt.

## Code map

| Piece | File |
|---|---|
| Contract types (`connections` row) | `apps/web/lib/connections/types.ts` |
| Table mirror (no migration here) | `apps/web/lib/connections/schema.ts` |
| Repository: Postgres, memory fallback | `apps/web/lib/connections/store.ts` |
| `getCurrentWorkspace()` stub | `apps/web/lib/connections/workspace.ts` |
| AES-256-GCM + HMAC state | `apps/web/lib/connections/crypto.ts` |
| Live validators | `apps/web/lib/connections/validate.ts` |
| Validate → encrypt → store | `apps/web/lib/connections/service.ts` |
| GitHub install state | `apps/web/lib/connections/github-state.ts` |
| API | `/api/connections` (GET), `/api/connections/{sentry,posthog}` (POST), `/api/connections/{provider}/test` (POST), `/api/connect/github/install`, `/api/connect/github/callback` |
| Cards | `apps/web/app/_components/connect-stack.tsx` |

Secrets never leave the server: GET returns `hasSecret`, never the ciphertext. Ciphertexts are
bound to their row (`<workspaceId>:<provider>` as GCM additional data), so a copied value fails to decrypt.

## GitHub (App `myroary`, via Vercel Connect `github/roary`)

1. **Install** → `/api/connect/github/install` signs `state = {workspaceId, nonce, exp}` (HMAC,
   15 min) and sets the nonce in an httpOnly cookie, then redirects to
   `https://github.com/apps/myroary/installations/new?state=…`.
2. **Callback** `/api/connect/github/callback?installation_id&setup_action&state` checks the
   signature, expiry, cookie nonce and that the signed-in workspace matches the state.
   `setup_action=request` (org owner must approve) → row `pending`.
3. **Verify** without the App private key: Vercel Connect holds it, so
   `getTokenResponse("github/roary", { subject: { type: "app" }, installationId })` mints an
   installation token. GitHub refuses for installations of other apps (Connect answers 422).
   Then `GET /installation/repositories` fills `config.repos`. `secret_ciphertext` stays null;
   tokens are minted on demand (15 min).
4. **First claim wins**: an installation already bound to another workspace is refused.

**Needs an owner action:** the App's *Setup URL* must be `https://<host>/api/connect/github/callback`
with "Redirect on update" on. That's a production App setting and wasn't changed here. Because
Connect owns the App, check first that Connect doesn't rely on its own Setup URL.

**Security gap, fix before shipping:** the callback trusts `installation_id` from the query string.
The signed state and nonce cookie only prove who started the flow, not that this user can
administer that installation. Installation ids are sequential, so first-claim-wins is a weak guard.
Fix: before claiming, get a GitHub *user* token and require that the id appears in
`GET /user/installations`. Probed: `startAuthorization("github/roary", { subject: { type: "user", id } }, { callbackUrl })`
returns a `connect.vercel.com/authorize/…` URL. So Connect can broker that user token with no
App setting change and no client secret on our side. Not wired yet: the end-to-end user consent
flow wasn't run.

### Webhook routing (design; implement on the foundation branch)

Every App webhook carries `installation.id`. In the eve GitHub channel (`agent/channels/github.ts`),
resolve the workspace before starting a session:

```ts
const conn = await store.findByGithubInstallation(String(payload.installation.id));
if (!conn || conn.status !== "connected") return null;           // unknown install: ignore
// start the session with workspaceId = conn.workspaceId, and pass installationId to the GitHub
// extension so tools act with that installation's token, not the default one.
```

`installation` / `installation_repositories` events should update `config.repos`, and
`installation.deleted` should set `status = 'error'`. Postgres lookup:
`where provider = 'github' and config->>'installationId' = $1` (add an expression index).

## Sentry

- **(a) Chat-time, per user:** already wired. `agent/connections/sentry.ts` uses
  `connect("sentry/sentry")`, a user-scoped Vercel Connect connector. When a tool needs it, Roary
  posts a `connect.vercel.com/authorize/…` link. The principal is the **Vercel/eve user** today,
  not the Neon Auth user. Once foundation maps a Neon user to the eve principal (for example,
  `subject: { type: "user", id: <neon user id> }` passed by the web chat's auth), each user's
  Sentry grant follows them. Web-side, `startAuthorization("sentry/sentry", { subject: { type: "user", id } }, { callbackUrl })`
  can start the same grant from `/settings/connections`.
- **(b) Autonomous:** paste an auth token + org + project. Validation calls
  `GET https://sentry.io/api/0/projects/{org}/{project}/`. If that answers 403 (the token has no
  `project:read`, which is true of the demo "Roary" internal integration), it falls back to
  `GET …/{project}/issues/?limit=1`, the scope triage actually needs. Records `checkedVia`.
  Stored encrypted. Self-hosted Sentry and non-US region hosts aren't supported yet.
- **Public integration** (one-click instead of pasting a token) needs a Sentry *public* integration:
  publish request and review by Sentry, a redirect URL (`/api/connect/sentry/callback`), and
  webhook URL + client secret for verifying `installation` hooks. Then exchange the install
  `code` for a token that refreshes every 8h.

## PostHog

Personal API key + project id + US/EU cloud. Validation: `GET {host}/api/projects/{id}/` with
`Bearer`. Only `us.posthog.com` / `eu.posthog.com` are accepted (no arbitrary hosts, so no SSRF).
The wrong region answers 401, and the UI says so. Stored encrypted.

## Env

| Name | Where | Notes |
|---|---|---|
| `CONNECTIONS_ENCRYPTION_KEY` | web | 32 bytes, base64 or hex (`openssl rand -base64 32`). Without it, connect routes answer 503 and the build still passes. |
| `VERCEL_OIDC_TOKEN` | web (automatic on Vercel) | Connect auth for `github/roary` tokens; local: `vercel env pull`. |
| `DATABASE_URL` | web | Postgres store once the `connections` table exists. |
| `CONNECTIONS_STORE=memory` | optional | Forces the in-memory store (tests, local). |
| `CONNECTIONS_DEV_WORKSPACE_ID` | local only | Acts as a signed-in workspace when Neon Auth env is missing; ignored when `NODE_ENV=production`. |
| `GITHUB_CONNECTOR`, `GITHUB_APP_SLUG` | optional | Default `github/roary`, `myroary`. |

## Plugging into santiago/connect-foundation

1. Delete `lib/connections/schema.ts` and import the foundation's `connections` table in `store.ts`
   (column names match the contract).
2. Replace the body of `getCurrentWorkspace()` with the real lookup (signed-in → their workspace;
   guest → demo). Callers use only `{ kind, id }`.
3. Nothing else changes: the store detects the table (it falls back to memory only on `42P01`).
4. Implement webhook routing (above) and make agent tools read the workspace's connection
   (decrypt with `decryptSecret(row.secretCiphertext, secretAad(workspaceId, provider))`).

## Tests

```bash
npx tsx scripts/connections-crypto-test.ts                                    # no network
npx tsx --env-file=.env.local scripts/connections-providers-test.ts           # Sentry, PostHog, GitHub via Connect
npx next dev apps/web -p 3101                                                 # then:
npx tsx --env-file=.env.local scripts/connections-ui-test.ts                  # guest
# restart with CONNECTIONS_DEV_WORKSPACE_ID=42, then:
MODE=member GITHUB_TEST_INSTALLATION_ID=<id> npx tsx --env-file=.env.local scripts/connections-ui-test.ts
```
