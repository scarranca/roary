# Roary: pitch

**Hook (1 line):** *"We didn't build another dashboard. We hired a teammate. It found why 24 of 42 checkouts were failing and opened the fix with tests, and it's not allowed to merge."*

Judges score **Usefulness, Creativity and Impact** equally (1–10). Every beat below names the criterion it earns. Stage directions live in [`DEMO.md`](./DEMO.md).

---

## Proof points (numbers we actually have)

Only use these. Don't invent MTTR, customers or cost figures.

1. **24 of 42 checkouts failing → root cause + fix PR with tests.** A seeded bug (commit `8d41418`, "Add bundle discount for multi-item carts") crashed every single-item checkout: 24 of 42 simulated shoppers (57%) got a 500. Roary named the exact line (`lines[1].lineTotal` with no length check) and the commit, then **opened [demo-shop PR #1](https://github.com/scarranca/roary-demo-shop/pull/1) on its own** through its GitHub app (`myroary`). *(Usefulness)*
2. **The fix is reviewable, not a guess.** +27 / −2 lines: a one-line guard plus 2 regression tests (single-item and multi-item carts). The tests pass 2/2 on the fix, the single-item test **fails with the original TypeError on the buggy code**, and the Vercel preview check passed. The PR states its confidence and what a reviewer should double-check. *(Usefulness, Impact)*
3. **One teammate instead of four tabs, on one platform.** Sentry (errors) + PostHog (impact) + GitHub (commits, PRs) + Vercel, in one conversation. Roary runs in production at [roary-rho.vercel.app](https://roary-rho.vercel.app) on eve + AI Gateway + Vercel Connect + Sandbox + Blob, with Neon Postgres. That's 0 API keys in code, and humans make 100% of merges. *(Impact, Creativity)*

---

## 3-minute talk track

Spoken words in quotes. Time stamps match `DEMO.md`.

### 0:00 Hook (Usefulness: the problem)
"Every small team has the same 2am problem. Something breaks, and four people open four tabs: Sentry for the error, PostHog for who's affected, GitHub for what changed, and an editor for the fix. We didn't build another dashboard. **We hired a teammate.** Meet Roary."

### 0:15 The hire (Creativity)
"You don't configure Roary, you **hire** it. You design what it looks like, give it a personality and a job description. Triage, fixes, launch reviews and launch videos are all on. One job is locked forever: **merging. Humans merge.**"

### 0:45 Something breaks (Usefulness: real stakes)
"We just shipped a bundle discount. Forty-two shoppers hit checkout… and **24 of them just failed.** Most people buy one item, and the discount code assumed two."

### 1:05 Roary investigates (Usefulness: 4 tools → 1 teammate)
"I just ask Roary, like a teammate. Watch: it's pulling the stack trace from Sentry, asking PostHog how many real shoppers hit it, and walking the GitHub history. It separates **what it saw** from **what it thinks** and tells us how confident it is. Root cause: the new discount reads the second cart line without checking there is one. The suspect is commit `8d41418`."

### 1:50 Roary fixes (Usefulness + Impact: closes the loop)
"It doesn't stop at a diagnosis. It opens the fix with a regression test that reproduces the crash and links the commit, and it says a human needs to merge. *(click)* That's the only click a human made. Error to fix, without the triage meeting."

### 2:15 Roary celebrates (Creativity)
"And when we ship something good, Roary celebrates. A merged feature PR becomes a launch video, built from code with HyperFrames, rendered in a Vercel Sandbox and posted back on the PR." *(play)*

### 2:45 Close (Impact)
"Roary runs entirely on Vercel: eve, AI Gateway, Connect, Sandbox and Blob. Any team on Vercel, GitHub, Sentry and PostHog can hire it with one `eve deploy`.
**Roary doesn't replace your team. It's the teammate who never sleeps and always says thank you.**"

---

## Criteria map (what judges should write down)

| Criterion | Our claim | Evidence on screen |
|---|---|---|
| **Usefulness** | Shortens error → fix: one teammate does the Sentry + PostHog + GitHub + editor loop. | Live triage report with impact counts, suspect commit, fix PR with tests. 24 of 42 failing → a fix one click from merged. |
| **Creativity** | A hire, not a tool: you design it (a 3D figure, personality, job description), and it celebrates launches with auto-made videos. | The Hire fitting room, the locked "Merge PRs" switch, the launch video playing. |
| **Impact** | Production-shaped on day one: every piece is a Vercel primitive, auth goes through Connect, state lives in Neon, and it deploys with one command. Safe by design. | Prod URL, the autonomous PR from the `myroary` GitHub app, guardrails in `agent/instructions.md`. |

---

## Anticipated judge Q&A

**"What stops it from doing something dangerous?"**
Hard guardrails in its instructions that no message overrides: it never merges, force-pushes, deletes branches, changes repo settings, promotes, rolls back, or touches env vars or domains. It asks before anything destructive or user-visible, and when unsure it *suggests* rather than acts. The repo rules require eve tool `approval` policies on anything destructive. Fixes go to a `roary/fix-*` branch and a PR, never to `main`. In the Hire UI the "Merge PRs" job is locked off. Ask it to merge on stage and it politely says no.

**"How does it get access? Are you storing tokens?"**
No secrets in code. GitHub and Sentry go through **Vercel Connect**: GitHub is a GitHub App installation (`myroary`, scoped to the repos you pick), and Sentry is user-scoped OAuth, so each person signs in once. PostHog uses a scoped personal API key in Vercel env vars, because Connect's PostHog OAuth exchange failed for us. Model calls go through AI Gateway with the deployment's OIDC token.

**"What does it cost?"**
Model is `anthropic/claude-sonnet-5` via AI Gateway, so you pay per token with one bill and can swap models without code changes. A triage plus a fix is one conversation with a handful of tool calls. We haven't measured the per-incident cost yet; AI Gateway reports it per request. Compute is Fluid functions plus a short Sandbox for renders, so there's nothing idle to pay for. *(Don't quote a dollar figure.)*

**"How does it scale to a real team or many repos?"**
eve sessions are durable workflows, so long investigations survive retries and restarts. Each incident is its own session, and Neon keeps the shared record (incidents, launches) the desk reads. Adding a repo means installing the GitHub App there. Adding a team means another `eve deploy` with their Connect connections. Scheduled launch reviews become Vercel Cron Jobs automatically.

**"Why eve / why Vercel?"**
Everything an AI teammate needs is already a Vercel primitive: durable agent runtime (eve), model routing (AI Gateway), OAuth to third-party tools (Connect), isolated code execution (Sandbox), file hosting (Blob), cron (schedules), and deploy previews as CI for its own PRs. We wrote an agent, not infrastructure, and that's why a hackathon team could ship it in a day.

**"Isn't this just a Sentry/Copilot feature?"**
Those each see one tab. Roary joins **errors + real user impact + the commit history**, then acts across them. It also does the human parts: blameless tone, explicit confidence, thanking people, and the launch video.

**"What if it's wrong?"**
It labels confidence (high, medium or low) and says what would raise it. It writes a regression test that has to fail on the old code. And a human always reviews and merges. PR #1 even flags an open question for the reviewer (should the discount apply to every item past the first?).

**"Was that live?"**
Say exactly which parts were live and which were the dry-run fallback. PR #1 was opened autonomously during an earlier run today.

---

## Closing line (verbatim, from README)

> **"Roary doesn't replace your team. It's the teammate who never sleeps and always says thank you."**
