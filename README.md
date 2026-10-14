# 🦁 Roary

> **The teammate you hire, not the tool you configure.**
> Roary is an AI engineer built on [Vercel eve](https://vercel.com/docs/eve) and hosted on Vercel. It's connected to your GitHub, Vercel, Sentry and PostHog. It notices when something breaks, figures out why, opens the fix, and makes a launch video when you ship something new. It stays friendly the whole time.

Built for the **Vercel Fast Forward Hackathon** (Oct 14, 2026).

---

## Why Roary

Small teams ship fast and break things. The loop between *"users are hitting an error"* and *"a fix is merged"* is still manual. Someone checks Sentry, someone checks PostHog to see whether it matters, someone digs through the diff, and someone writes the fix. Then, when a good feature does ship, nobody has time to announce it properly.

Roary closes that loop. You don't configure it like a dashboard. You **hire** it: it gets a name, a personality, access to your stack, and a clear job description.

## What Roary does

| Job | Trigger | What happens |
|---|---|---|
| 🚨 **Understand errors as they happen** | Sentry issue / spike | Pulls the stack trace (Sentry MCP) and checks real user impact (PostHog MCP). Then it finds the commit that likely caused it (GitHub) and posts a plain-English diagnosis. |
| 🛠️ **Suggest fixes or open PRs** | After diagnosis, or `@roary fix this` | Reproduces the problem in an eve sandbox, writes the patch and opens a PR that links the Sentry issue. **Merging always needs a human.** |
| 🔍 **Review recent launches** | Daily schedule + each Vercel production deploy | Looks at what shipped in the last 24h (Vercel deployments + merged PRs). It compares errors before and after (Sentry + Vercel runtime logs) and usage (PostHog), then posts a short launch health report. If a deploy is clearly bad, it can *suggest* a rollback; a human runs it. |
| 🎬 **Make launch videos** | A PR labeled `feature` / `launch` merges | Reads the PR and writes a [HyperFrames](https://hyperframes.heygen.com) HTML composition. It renders an MP4, uploads it to Vercel Blob and posts the link back on the PR, ready to share. |
| 💛 **Be mindful and friendly** | Always | Says what it's confident about and what it isn't. Never blames people. It keeps quiet unless something matters, and asks before doing anything risky. |

## How it maps to the judging criteria

| Criterion (1/3 each) | Roary's answer |
|---|---|
| **Usefulness:** solves a real problem effectively | It cuts the time from error to fix (MTTR). One agent replaces four tabs (Sentry, PostHog, GitHub, the editor) and the triage meeting. |
| **Creativity:** novel approach, technical originality | It's framed as a hire, not a tool: a persona, a job description, and it takes the initiative. It is also the first agent we know of that *celebrates* your launches by turning merged PRs into launch videos automatically. |
| **Impact:** scale, value creation, execution | Any team on Vercel + GitHub + Sentry + PostHog can use it. It's built entirely on Vercel's platform (eve sessions, Workflows, Sandbox, Connect, AI Gateway, Blob), so it's production-shaped from day one and one `eve deploy` away for any Vercel team. |

## Architecture

```
             ┌──────────── triggers ────────────┐
  GitHub webhooks   Vercel deploys   Sentry alerts   eve schedules (cron)   HTTP / chat
             └──────────────┬───────────────────┘
                            ▼
                ┌──────────────────────┐
                │   Roary (eve agent)  │  agent/instructions.md = personality + rules
                │  durable sessions    │  agent/memory/        = what it remembers about the team
                └──────────┬───────────┘
     ┌────────────┬────────────┼─────────────┬──────────────────┐
     ▼            ▼            ▼             ▼                  ▼
 Sentry MCP  PostHog MCP   Vercel MCP   GitHub tools      Vercel Sandbox
 (errors)    (impact)      (deploys,    (PRs, reviews)    (repro, patch, HyperFrames render)
                            runtime logs)                       │
                                                                ▼
                                                    launch-video.mp4 → Vercel Blob
```

**Stack:** Vercel (hosting) · eve · AI Gateway · Vercel Connect (OAuth for GitHub/Sentry/PostHog) · Vercel Sandbox · Vercel Workflows · Vercel Cron (eve schedules) · Vercel Blob (videos) · Neon Postgres + Drizzle (state) · HyperFrames (HeyGen) · TypeScript · Node 24.

## Project layout (planned)

```
agent/
  agent.ts                 # defineAgent: model + settings
  instructions.md          # Roary's personality, values, guardrails
  connections/
    sentry.ts              # Sentry MCP (https://mcp.sentry.dev/mcp)
    posthog.ts             # PostHog MCP (https://mcp.posthog.com/mcp)
    vercel.ts              # Vercel MCP (https://mcp.vercel.com): deployments, runtime logs
  channels/
    github.ts              # @roary mentions + webhooks
  tools/
    github.ts              # @github-tools/sdk: PRs, comments, reviews
    render_launch_video.ts # runs HyperFrames render in the sandbox, uploads to Blob
    save_incident.ts       # upsert an incident in Neon  ✅
    list_incidents.ts      # read incidents from Neon  ✅
  skills/
    triage-error.md        # error → diagnosis → fix playbook
    review-launch.md       # 24h launch health report playbook
    launch-video.md        # PR → HyperFrames composition playbook
  schedules/
    daily-launch-review.ts # cron: morning launch report
  memory/
    team.ts                # stable facts about the repo & team
  lib/
    db.ts                  # Neon Postgres (pg pool + Drizzle)  ✅
    schema.ts              # incidents, launches  ✅
  sandbox.ts               # Vercel Sandbox on Vercel, just-bash locally  ✅
  sandbox/workspace/       # files copied into /workspace (video templates, etc.)
drizzle/                   # SQL migrations (drizzle-kit)
neon.ts                    # Neon services config (neon deploy)
scripts/db-smoke.ts        # end-to-end DB check
evals/                     # eve evals for triage quality
```

## Getting started

**Prereqs:** Node 24+, the Vercel CLI, FFmpeg (for local video renders), and access to the team's Vercel project.

```bash
# 1. Install
npm install

# 2. Link to Vercel and pull env (gives you VERCEL_OIDC_TOKEN → AI Gateway + Connect)
vercel link
vercel env pull

# 2b. Neon database (DATABASE_URL, DATABASE_URL_UNPOOLED → .env.local)
npm i -g neon@latest && neon login
neon env pull            # project is already linked via neon init
npm run db:migrate       # apply drizzle/ migrations
npx tsx --env-file=.env.local scripts/db-smoke.ts   # prove the DB works

# 3. Connect the integrations (one time per project)
# Sentry + PostHog are already created in roary-hack (UIDs sentry/sentry, posthog/posthog).
# From scratch: create, then attach the UID it prints (not the --name).
vercel connect create sentry  --connection-method mcp --name sentry  --yes   # → sentry/sentry
vercel connect create posthog --connection-method mcp --name posthog --yes   # → posthog/posthog
vercel connect attach sentry/sentry --yes && vercel connect attach posthog/posthog --yes
vercel connect create github --name github/roary
vercel connect attach github/roary --triggers --trigger-path /eve/v1/github

# 4. Check that eve sees every tool/connection/skill
npx eve info

# 5. Run locally (terminal UI; server on http://127.0.0.1:2000)
npm run dev
```

Run a schedule by hand (schedules don't fire on their own in local dev):

```bash
curl -X POST http://127.0.0.1:2000/eve/v1/dev/schedules/daily-launch-review
```

Deploy (Vercel):

```bash
npx eve deploy           # production (runs vercel deploy --prod)
vercel deploy            # preview: use this to test webhooks / @mentions
```

**Vercel project setup (one time):**
- Create or link the `roary` project: `vercel link`.
- Enable **AI Gateway** on the team (model calls go through it via `VERCEL_OIDC_TOKEN`).
- Create a **Blob store** and connect it to the project (this adds `BLOB_READ_WRITE_TOKEN`).
- Schedules in `agent/schedules/` become **Vercel Cron Jobs** automatically (UTC).
- Watch runs in the Vercel dashboard → **Agent Runs**; logs via `npx eve logs` / `npx eve traces`.

> ⚠️ GitHub webhooks and `@roary` mentions are only forwarded to **deployed** URLs, not to localhost. Test those flows on a preview deployment.

### Environment variables

| Var | Needed for | Source |
|---|---|---|
| `VERCEL_OIDC_TOKEN` | AI Gateway + Vercel Connect | `vercel env pull` |
| `DATABASE_URL` | App queries (pooled Neon connection) | `neon env pull` |
| `DATABASE_URL_UNPOOLED` | Migrations (direct connection) | `neon env pull` |
| `BLOB_READ_WRITE_TOKEN` | Uploading rendered launch videos | Added when you connect a Vercel Blob store |
| `HEYGEN_API_KEY` | *Optional.* HyperFrames cloud render (local render needs no key) | HeyGen dashboard |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `eve remote` against protected deployments | Vercel project settings |

Never commit `.env*` files.

## 3-minute demo script

1. **(0:00) The hire.** "Meet Roary, our newest engineer." Show the `instructions.md` personality and the three connections.
2. **(0:30) Something breaks.** Push a commit with a deliberate bug to the demo app (also on Vercel). It deploys, we trigger the error, and Sentry fires.
3. **(1:00) Roary investigates.** Live: Sentry stack trace → PostHog shows that "42 users hit this in checkout" → Vercel shows the deploy that introduced it → it points to the culprit commit.
4. **(1:45) Roary fixes it.** A PR opens with the fix, a test and a friendly explanation. A human clicks merge.
5. **(2:15) Roary celebrates.** We merge a `feature` PR. Roary renders and posts a launch video. **Play the video.**
6. **(2:45) Close.** "Roary doesn't replace your team; it's the teammate who never sleeps and always says thank you."

## Team

| Area | Owner |
|---|---|
| eve agent core + instructions | _TBD_ |
| Sentry + PostHog triage flow | _TBD_ |
| GitHub PR / fix flow | _TBD_ |
| HyperFrames launch videos | _TBD_ |
| Demo app + pitch | _TBD_ |

See [`AGENTS.md`](./AGENTS.md) for how coding agents (and humans) should work in this repo.

## References

- eve: https://vercel.com/docs/eve · https://eve.dev/docs · https://eve.dev/llms.txt
- HyperFrames: https://hyperframes.heygen.com · https://hyperframes.heygen.com/llms.txt · https://github.com/heygen-com/hyperframes
- Sentry MCP: https://mcp.sentry.dev/mcp · PostHog MCP: https://mcp.posthog.com/mcp · Vercel MCP: https://vercel.com/docs/mcp
- Vercel Blob: https://vercel.com/docs/vercel-blob
