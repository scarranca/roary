# 🦁 Roary

> **The teammate you hire, not the tool you configure.**
> Roary is an AI engineer you hire onto your team. It watches Sentry and PostHog, works in your GitHub, and runs on [Vercel eve](https://vercel.com/docs/eve). When something breaks, it finds out why and opens the fix. When you ship, it makes the launch video. It never merges.

Built for the **Vercel Fast Forward Hackathon** (Oct 14, 2026).

| | |
|---|---|
| 🟢 **Roary in production** | https://roary-rho.vercel.app |
| 🛒 **Demo shop it watches** | https://roary-demo-shop.vercel.app ([repo](https://github.com/scarranca/roary-demo-shop)) |
| 🛠️ **Roary's first autonomous fix PR** | [roary-demo-shop#1](https://github.com/scarranca/roary-demo-shop/pull/1): root cause + one-line guard + 2 regression tests, opened by Roary's GitHub app. *A human reviews and merges.* |
| 🎬 **Demo run-of-show / pitch** | [`docs/DEMO.md`](./docs/DEMO.md) · [`docs/PITCH.md`](./docs/PITCH.md) |

**Proof so far:** a seeded bug made **24 of 42** checkouts fail. Roary named the line and the commit (`8d41418`), then opened a fix PR whose single-item test fails on the old code and passes on the fix.

---

## Why Roary

Small teams ship fast and break things. Getting from *"users are hitting an error"* to *"a fix is merged"* is still manual: someone checks Sentry, someone checks PostHog to see whether it matters, someone digs through the diff, someone writes the fix. And when a good feature ships, nobody has time to announce it.

Roary closes that loop. You don't configure it like a dashboard. You **hire** it: it gets a name, a personality, access to your stack, and a job description.

## Roary's 4 jobs

| Job | Trigger | What happens | Status |
|---|---|---|---|
| 🚨 **Triage errors** | Sentry issue, or ask in chat | Pulls the stack trace (Sentry API, app token), counts affected users (PostHog MCP) and finds the likely culprit commit (GitHub). Then it posts a plain-English incident report with an explicit confidence level. | Connections live; triage skill in progress (#6/#7) |
| 🛠️ **Open fix PRs** | After triage, or `@roary fix this` | Writes the minimal patch plus a regression test on a `roary/fix-*` branch and opens a PR linking the incident. **Merging always needs a human.** | Proven on `eve dev` ([shop#1](https://github.com/scarranca/roary-demo-shop/pull/1)); skill in progress (#32) |
| 🔍 **Review launches** | Daily + each prod deploy | Summarizes what shipped in the last 24h and how errors and usage changed. It can *suggest* a rollback; a human runs it. | Planned |
| 🎬 **Make launch videos** | A PR labeled `feature` / `launch` merges | Turns the PR into a [HyperFrames](https://hyperframes.heygen.com) composition, renders an MP4 in Vercel Sandbox, uploads it to Blob and posts the link on the PR. | Template done; render + trigger in progress (#31) |

Always: **friendly and mindful.** Blameless, separates *what I saw* from *what I think*, stays quiet unless something matters, and asks before anything risky ([`agent/instructions.md`](./agent/instructions.md)).

**Hire Roary web app** (landing, desk, a 3D "fitting room" to design your Roary, public chat): in progress (#29, #30, #33).

## How it maps to the judging criteria

| Criterion (1/3 each) | Roary's answer | Proof |
|---|---|---|
| **Usefulness** | Error → fix with one teammate instead of four tabs (Sentry, PostHog, GitHub, editor) and a triage meeting. | 24 of 42 failing checkouts → root cause + fix PR with tests ([shop#1](https://github.com/scarranca/roary-demo-shop/pull/1)) |
| **Creativity** | A hire, not a tool: you design it, give it a personality and a job description, and it takes initiative. It also *celebrates* launches by turning merged PRs into launch videos. | Hire fitting room, the locked "Merge PRs" switch, HyperFrames videos |
| **Impact** | Any team on Vercel + GitHub + Sentry + PostHog can hire it. Every piece is a Vercel primitive (eve, AI Gateway, Connect, Sandbox, Blob, Cron), so it's production-shaped and one `eve deploy` away. Safe by design: humans merge. | Live at [roary-rho.vercel.app](https://roary-rho.vercel.app) |

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

**Stack:** Vercel (hosting) · eve · AI Gateway · Vercel Connect (GitHub App + Sentry OAuth; PostHog via API key) · Vercel Sandbox · Vercel Workflows · Vercel Cron (eve schedules) · Vercel Blob (videos) · Neon Postgres + Drizzle (state) · HyperFrames (HeyGen) · TypeScript · Node 24.

## Project layout

✅ = merged · 🚧 = in progress (open PR) · 📝 = planned

```
agent/
  agent.ts                 # defineAgent: model (claude-sonnet-5 via AI Gateway)   ✅
  instructions.md          # Roary's personality, values, guardrails                ✅
  connections/
    posthog.ts             # PostHog MCP (personal API key)                         ✅
    vercel.ts              # Vercel MCP: deployments, runtime logs (read-only)      📝
  channels/
    eve.ts                 # chat (browser auth for the public demo: #33)           ✅ 🚧
    github.ts              # @roary mentions + webhooks (Vercel Connect)            ✅
  extensions/
    github.ts              # @github-tools/eve-extension: PRs, commits, comments    ✅
  tools/
    save_incident.ts       # upsert an incident in Neon                             ✅
    list_incidents.ts      # read incidents from Neon                               ✅
    render_launch_video.ts # HyperFrames render in Sandbox → Blob                   🚧 #31
  skills/
    triage-error.md        # error → diagnosis playbook                             🚧 #6/#7
    fix-error.md           # diagnosis → patch + regression test PR                 🚧 #32
    review-launch.md       # 24h launch health report playbook                      📝
    launch-video.md        # PR → HyperFrames composition playbook                  🚧 #31
  schedules/
    daily-launch-review.ts # cron: morning launch report                            📝
  memory/                  # stable facts about the repo & team                     📝
  lib/
    db.ts                  # Neon Postgres (pg pool + Drizzle)                      ✅
    schema.ts              # incidents, launches                                    ✅
  sandbox/sandbox.ts       # Vercel Sandbox on Vercel, just-bash locally            ✅
  sandbox/workspace/video/ # branded HyperFrames template (content.json)            ✅
apps/web/                  # Hire Roary web app: landing, /desk, /hire fitting room ✅
drizzle/                   # SQL migrations (drizzle-kit)                           ✅
neon.ts                    # Neon services config (neon deploy)                     ✅
scripts/db-smoke.ts        # end-to-end DB check                                    ✅
scripts/seed-demo.ts       # seed/unseed past demo incidents + launches (SEED-)     ✅
scripts/demo-reset.md      # restore / re-break the demo shop, clean Neon           ✅
docs/DEMO.md · PITCH.md    # run-of-show, talk track, judge Q&A                     ✅
evals/                     # eve evals for triage quality                           📝
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
# Sentry and GitHub are already created in roary-hack (UIDs sentry/sentry, github/roary).
# From scratch: create, then attach the UID it prints (not the --name).
vercel connect create sentry  --connection-method mcp --name sentry  --yes   # → sentry/sentry
# PostHog: no Connect (OAuth exchange fails). Set POSTHOG_API_KEY instead (personal API key, "MCP Server" preset)
vercel connect attach sentry/sentry --yes
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
| `POSTHOG_API_KEY` | PostHog MCP (app-level personal API key) | PostHog → Settings → Personal API keys |
| `BLOB_READ_WRITE_TOKEN` | Uploading rendered launch videos | Added when you connect a Vercel Blob store |
| `HEYGEN_API_KEY` | *Optional.* HyperFrames cloud render (local render needs no key) | HeyGen dashboard |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `eve remote` against protected deployments | Vercel project settings |

Never commit `.env*` files.

## 3-minute demo

Full run-of-show with timings, exact prompts, fallbacks and the pre-demo checklist: **[`docs/DEMO.md`](./docs/DEMO.md)**. Reset commands: [`scripts/demo-reset.md`](./scripts/demo-reset.md).

1. **(0:00) The hire.** "Meet Roary, our newest engineer." Design it in the Hire UI. "Merge PRs" is locked off.
2. **(0:45) Something breaks.** A "bundle discount" PR merges into the demo shop, and simulated traffic shows single-item checkouts failing (24 of 42 in testing).
3. **(1:05) Roary investigates.** Sentry stack trace → PostHog impact → GitHub culprit commit, in one incident report.
4. **(1:50) Roary fixes it.** A PR opens with the fix, a regression test and a friendly explanation. A human clicks merge.
5. **(2:15) Roary celebrates.** A merged `feature` PR gets a launch video. **Play the video.**
6. **(2:45) Close.** "Roary doesn't replace your team. It's the teammate who never sleeps and always says thank you."

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
