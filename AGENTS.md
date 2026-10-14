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
- **Video storage:** upload rendered MP4s with `@vercel/blob` (`put(path, file, { access: 'public' })`, which needs `BLOB_READ_WRITE_TOKEN`), then post the Blob URL on the PR.
- **Sandbox:** the built-in `bash`, `read_file` and `write_file` tools. Files in `agent/sandbox/workspace/**` land in `/workspace/`.

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
npx eve dev            # local dev + terminal UI
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
- The local dev port differs between docs (2000 vs 3000). Check what `eve dev` prints.
- We're on Vercel: every PR gets a **preview deployment**. Use it for anything webhook-driven.
- eve schedules become **Vercel Cron Jobs** in UTC. Write cron times in UTC, not local time.
- Rendering video in a Function is heavy. Render inside **Vercel Sandbox** (or use HyperFrames cloud render), not in the request path.
- Replace `placeholderAuth()` before any public deployment.
- Use the single-file `memory.ts` **or** the `memory/` directory, not both.
- Files named `*.test.*` are skipped by eve discovery.

## Before you open a PR

- [ ] `npx eve info --json` has no diagnostics
- [ ] Types pass and the new tool has a zod schema + a description written for the model
- [ ] No secrets or `.env*` committed
- [ ] Destructive actions are behind approval (GitHub merges, Vercel promote/rollback/env changes)
- [ ] Preview deployment works
- [ ] Tested on the demo path (or noted why not)
