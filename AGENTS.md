# AGENTS.md

Guidance for **coding agents** (Claude Code, Cursor, Codex, v0…) and humans working on the Roary repo.
Roary's own runtime personality lives in `agent/instructions.md`. This file is about *building* Roary.

## Context in 30 seconds

- Roary is a **Vercel eve agent**, **hosted on Vercel**, that teams "hire". It watches **Sentry** (errors), **PostHog** (impact) and **Vercel** (deployments, runtime logs). It acts on **GitHub** (diagnoses, fix PRs, launch reviews), and makes **launch videos with HyperFrames** when features ship.
- We are at a **hackathon**. Judges score **Usefulness, Creativity and Impact** equally (1–10 each), with a **3-minute live demo**. Optimize for a demo that works end to end over breadth.
- eve is **beta**. Don't trust memory for its APIs; check the docs (see below).

## Golden rules

1. **Read the installed docs before writing eve code.** The source of truth is `node_modules/eve/docs/` (start at `README.md`), then https://eve.dev/llms.txt. Don't invent eve APIs. If something isn't documented, say so and ask.
2. **Run `npx eve info --json` after adding or renaming anything in `agent/`.** It shows discovered tools, connections, skills, schedules and diagnostics. Fix every diagnostic.
3. **The filesystem is the config.** One tool per file in `agent/tools/`, and the filename is the tool name (`snake_case.ts`). Connections go in `agent/connections/`, channels in `agent/channels/`, playbooks in `agent/skills/`.
4. **Humans merge.** Roary may open PRs and comment, but it must never merge, force-push, delete branches, or change repo settings. Use eve tool `approval` policies (`always()` for anything destructive) and GitHub tools' `requireApproval`.
5. **No secrets in code.** Auth goes through Vercel Connect (`connect("sentry")`, `connect("posthog")`, `getToken("github/roary", …)`). Env comes from `vercel env pull`. Never commit `.env*`.
6. **Demo first.** Before a feature counts as done, it has to work on the real demo path described in `README.md`.

## Stack & conventions

- **Runtime:** Node 24+, TypeScript (strict), ESM. eve + `ai` v7 + `zod`.
- **Validation:** every tool has a `zod` `inputSchema` with `.describe()` on each field, because the model reads those descriptions.
- **Tool descriptions:** write them for the model. Say *when* to use the tool, not just what it does.
- **Model:** set in `agent/agent.ts` via `defineAgent({ model })`, routed through AI Gateway. Change it with `eve set model`, not by hardcoding provider keys.
- **Naming:** files `kebab-case`, tools `snake_case`, types `PascalCase`.
- **Style:** small files, no dead code, comments only where the *why* isn't obvious.

### eve building blocks (verified from docs)

```ts
// agent/agent.ts
import { defineAgent } from 'eve';
export default defineAgent({ model: '<provider/model-id>' });
```

```ts
// agent/tools/<tool_name>.ts
import { defineTool } from 'eve/tools';
import { z } from 'zod';
export default defineTool({
  description: 'When and why to call this tool.',
  inputSchema: z.object({ issueId: z.string().describe('Sentry issue id') }),
  async execute({ issueId }, ctx) { /* ctx.session, ctx.getSandbox(), ctx.abortSignal */ },
});
```

```ts
// agent/connections/sentry.ts   (posthog.ts is identical with mcp.posthog.com + connect("posthog"))
import { connect } from '@vercel/connect/eve';
import { defineMcpClientConnection } from 'eve/connections';
export default defineMcpClientConnection({
  url: 'https://mcp.sentry.dev/mcp',
  description: 'Sentry: search, query, and debug errors and issues.',
  auth: connect('sentry'),
});
```

- **GitHub:** use `@github-tools/sdk/eve` (`createGithubTools`) in `agent/tools/github.ts`, with `githubChannel` from `eve/channels/github` in `agent/channels/github.ts`.
- **Schedules:** `defineSchedule` from `eve/schedules` (5-field cron, **UTC**). Locally they only run via `POST /eve/v1/dev/schedules/<name>`.
- **Memory:** `defineMemory` from `eve/memory`, in `agent/memory/<slot>.ts`.
- **Vercel (MCP):** `agent/connections/vercel.ts` → `defineMcpClientConnection({ url: 'https://mcp.vercel.com', ... })`. **UNVERIFIED for eve:** check whether `eve add connection/vercel` exists (`eve registry search vercel`) and which auth it uses before hand-writing it. Read-only usage only: list deployments, runtime errors/logs. **Never** promote, roll back, or change env vars/domains; Roary may only *suggest* a rollback.
- **Database:** Neon Postgres + Drizzle. See [Database (Neon)](#database-neon) below.
- **Video storage:** upload rendered MP4s with `@vercel/blob` (`put(path, file, { access: 'public' })`, which needs `BLOB_READ_WRITE_TOKEN`), then post the Blob URL on the PR.
- **Sandbox:** the built-in `bash`, `read_file` and `write_file` tools. Files in `agent/sandbox/workspace/**` land in `/workspace/`.

## Database (Neon)

Roary's records (incidents, launches, videos) live in **Neon Postgres** and are accessed with **Drizzle ORM** over `pg`.

| Thing | Value |
|---|---|
| Neon org | `org-noisy-breeze-37204220` |
| Neon project | `young-surf-15904408` |
| Main branch | `production` (the real data; Roary on Vercel uses it) |
| Client | `agent/lib/db.ts` → exports `db` and `schema` |
| Tables | `agent/lib/schema.ts` (`incidents`, `launches`) |
| Migrations | `drizzle/` (generated, committed) |
| Env vars | `DATABASE_URL` (pooled, app), `DATABASE_URL_UNPOOLED` (direct, migrations) |

### 1. Get access (once per machine)

```bash
npm i -g neon@latest
neon login                                   # browser sign-in; ask Santiago for an invite to the Neon org
neon env pull --project-id young-surf-15904408 --branch production
# → writes DATABASE_URL, DATABASE_URL_UNPOOLED, NEON_BRANCH to .env.local (gitignored)
npx tsx --env-file=.env.local scripts/db-smoke.ts   # should print foundInList: true
```

`.neon` is gitignored, so you won't have it after cloning. Passing `--project-id` / `--branch` works without it.

### 2. Read and write from code

Always import the shared client. **Never** create your own `Pool`/`Client`, because the shared one is wired to `attachDatabasePool` for Vercel Fluid compute.

```ts
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

// insert
const [incident] = await db
  .insert(schema.incidents)
  .values({ sentryIssueId: "ROARY-12", title: "Checkout crash", status: "investigating" })
  .returning();

// upsert (idempotent; webhooks and retries can fire twice)
await db
  .insert(schema.incidents)
  .values({ sentryIssueId: "ROARY-12", title: "Checkout crash", status: "diagnosed" })
  .onConflictDoUpdate({
    target: schema.incidents.sentryIssueId,
    set: { status: "diagnosed", updatedAt: sql`now()` },
  });

// select
const open = await db
  .select()
  .from(schema.incidents)
  .where(and(eq(schema.incidents.status, "diagnosed"), gte(schema.incidents.usersAffected, 10)))
  .orderBy(desc(schema.incidents.createdAt))
  .limit(10);

// update
await db.update(schema.launches).set({ videoUrl: blobUrl }).where(eq(schema.launches.id, launchId));
```

### 3. Expose data to Roary via a tool

The model never writes SQL. It calls typed tools that use `db`. Copy `agent/tools/save_incident.ts` / `list_incidents.ts` as the template:

```ts
// agent/tools/save_launch.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { db, schema } from "../lib/db";

export default defineTool({
  description: "Record a shipped feature (merged PR) so launch reviews and videos can reference it.",
  inputSchema: z.object({
    repo: z.string().describe("owner/name"),
    prNumber: z.number().int().describe("Merged PR number"),
    title: z.string().describe("Feature title, human readable"),
  }),
  async execute(input) {
    const [row] = await db.insert(schema.launches).values(input).returning();
    return row; // return small, JSON-friendly objects; the model reads them
  },
});
```

Rules for DB tools:
- Validate every input with zod. Never interpolate model input into raw SQL. If you need raw SQL, use Drizzle's `sql` template (it parameterizes).
- Bound reads (`.limit()`, max 50) so tool output stays small.
- Make writes idempotent (upsert on a natural key) because eve steps can retry.
- No `DELETE` / `TRUNCATE` tools for Roary. If one is ever needed, it goes behind `approval: always()`.

### 4. Change the schema

```bash
# a) recommended: work on your own throwaway Neon branch (auto-expires in 7 days, per neon.ts)
neon checkout dev-<yourname>
neon env pull                      # .env.local now points at your branch

# b) edit agent/lib/schema.ts, then:
npm run db:generate                # writes drizzle/NNNN_*.sql, so review it
npm run db:migrate                 # applies to the branch in .env.local (direct connection)
npm run typecheck && npm run build

# c) commit schema.ts + the new drizzle/ file in the same PR
```

- After the PR merges, one person runs `npm run db:migrate` against `production` (`neon env pull --project-id young-surf-15904408 --branch production` first). Say in the PR who will do it.
- **Never** edit or delete a migration that has already been applied. Add a new one instead.
- **Never** run DDL by hand (psql, Neon console, MCP). Schema lives in code.
- Prefer additive changes (new nullable columns, new tables). Dropping or renaming columns while Roary runs on Vercel breaks the live agent.

### 5. Production on Vercel

- The deployed agent reads `DATABASE_URL` from the Vercel project env. Add it once, using the **pooled** URL from the `production` branch (`vercel env add DATABASE_URL production`, or install the Neon integration in Vercel). `DATABASE_URL_UNPOOLED` is only needed where migrations run.
- Don't run migrations inside the agent or at build time. Run them from a laptop/CI as above.

### 6. Debugging

```bash
npm run db:studio                                   # browse tables (Drizzle Studio)
neon psql production                                # read-only poking; no DDL
neon inspect db outliers                            # slow queries
neon inspect db table-sizes                         # storage
```

- `SECURITY WARNING: The SSL modes 'prefer', 'require'...` from `pg` is harmless.
- `ECONNREFUSED` / `DATABASE_URL undefined` → you skipped `neon env pull`, or you're running a script without `--env-file=.env.local`.
- Neon scales to zero, so the first query after idle can take ~0.5s. That's normal.

### Neon vs eve memory

| Use Neon (`db`) for | Use eve `defineMemory` for |
|---|---|
| Records the team can query/list: incidents, launches, videos, review reports | Soft facts Roary remembers about people/the team ("this team prefers short PR descriptions") |

## Workstreams

| # | Workstream | Key files | Done when |
|---|---|---|---|
| 1 | Agent core + personality | `agent/agent.ts`, `agent/instructions.md`, `agent/memory/` | `eve dev` chats as Roary, `eve info` is clean |
| 2 | Error triage | `agent/connections/{sentry,posthog}.ts`, `agent/skills/triage-error.md` | Given a Sentry issue, Roary posts the root cause, user impact and the suspect commit |
| 3 | Fix PRs | `agent/tools/github.ts`, `agent/channels/github.ts` | Roary opens a PR with the fix + test that links the Sentry issue, and a human merges |
| 4 | Launch review | `agent/connections/vercel.ts`, `agent/schedules/daily-launch-review.ts`, `agent/skills/review-launch.md` | Daily report (and one per prod deploy): Vercel deploys + PRs merged in the last 24h, with the error and usage change for each |
| 5 | Launch videos | `agent/tools/render_launch_video.ts`, `agent/skills/launch-video.md`, `agent/sandbox/workspace/video/` | A merged `feature` PR produces an MP4, uploaded to Vercel Blob and linked on the PR |

Each workstream should be mergeable on its own. Keep PRs small and say which workstream they belong to.

## Launch videos with HyperFrames

- HyperFrames compositions are **HTML + GSAP**, not JSON. Timing uses `data-start`, `data-duration` and `data-track-index`. The timeline is registered on `window.__timelines.<compositionId>`.
- Keep a branded base template in `agent/sandbox/workspace/video/`. Roary only fills in content (title, bullets, screenshots, before/after numbers) rather than writing a layout from scratch, which keeps renders reliable.
- **Render:**
  - **Local / sandbox (no key):** `npx hyperframes render --output launch.mp4`. Use `--quality draft` while iterating. This needs FFmpeg.
  - **Cloud:** `hyperframes cloud render --callback-url <url> --no-wait` with `HEYGEN_API_KEY`.
- Run `npx hyperframes lint` and `npx hyperframes check` before rendering.
- HyperFrames ships agent skills, including `/pr-to-video` and `/product-launch-video`. Use them while developing templates: `npx skills add heygen-com/hyperframes`. Its docs index is https://hyperframes.heygen.com/llms.txt.

## Roary's runtime personality (summary, full version in `agent/instructions.md`)

- **Friendly and mindful.** Warm, concise, never blames a person. Talks about "the change", not "your mistake".
- **Honest about confidence.** Always separates *what I saw* from *what I think*.
- **Calm.** Speaks up only when something matters: real user impact, regressions, or launches.
- **Safe.** Asks before risky actions and never merges. When unsure, it suggests a fix instead of pushing one.
- **Celebrates.** Thanks the people who shipped, and makes the launch video.

## Commands

```bash
npm install            # deps
npm run dev            # eve dev + terminal UI (http://127.0.0.1:2000)
npm run build          # eve build (must pass before PRs)
npm run typecheck      # tsc
npm run db:generate    # drizzle-kit: SQL from agent/lib/schema.ts
npm run db:migrate     # apply migrations to Neon
npx tsx --env-file=.env.local scripts/db-smoke.ts  # DB end-to-end check
npx eve info --json    # validate agent/ discovery
npx eve eval           # run evals in evals/
npx eve deploy         # deploy to Vercel (prod)
vercel deploy          # preview deploy: test webhooks / @mentions here
npx eve logs / traces  # debug deployed runs (also: Vercel dashboard → Agent Runs)
vercel env pull        # refresh env (VERCEL_OIDC_TOKEN)
npx hyperframes preview / render / lint / check
```

## Gotchas

- GitHub webhooks and `@mentions` only reach **deployed** URLs. Use a preview deployment to test them.
- The local dev server runs at `http://127.0.0.1:2000` (eve v0.79).
- `agent/sandbox.ts` uses **just-bash** locally (no Docker/VM needed) and **Vercel Sandbox** on Vercel. just-bash can't run native binaries, so FFmpeg/HyperFrames renders only work in Vercel Sandbox, or locally outside eve via `npx hyperframes render`.
- Without `vercel link && vercel env pull` (or `/login` in the eve TUI), model calls fail with "The model connection is unavailable".
- We're on Vercel: every PR gets a **preview deployment**. Use it for anything webhook-driven.
- eve schedules become **Vercel Cron Jobs** in UTC. Write cron times in UTC, not local time.
- Rendering video in a Function is heavy. Render inside **Vercel Sandbox** (or use HyperFrames cloud render), not in the request path.
- Replace `placeholderAuth()` before any public deployment.
- Use the single-file `memory.ts` **or** the `memory/` directory, not both.
- Files named `*.test.*` are skipped by eve discovery.

## Before you open a PR

- [ ] `npx eve info --json` has no diagnostics and `npm run build` passes
- [ ] Schema changes come with a generated migration in `drizzle/`
- [ ] Types pass and the new tool has a zod schema + a description written for the model
- [ ] No secrets or `.env*` committed
- [ ] Destructive actions are behind approval (GitHub merges, Vercel promote/rollback/env changes)
- [ ] Preview deployment works
- [ ] Tested on the demo path (or noted why not)
