# Roary: 3-minute demo run-of-show

The live path: **hire Roary in the UI → break the shop → traffic → Roary triage report → Roary fix PR → human merges → launch video for a merged feature PR.**
Every beat has a cutover rule and a fallback. If a fallback fires, say it plainly ("here's the run from 20 minutes ago") and keep moving. Never debug on stage.

Talk track and judge Q&A: [`PITCH.md`](./PITCH.md). Reset commands: [`scripts/demo-reset.md`](../scripts/demo-reset.md).

---

## 0. Merge gate (read first)

As of 2:05pm PT, production (`https://roary-rho.vercel.app`) runs only the merged PRs #25–#28: personality, GitHub channel + tools, Sentry + PostHog connections, JSON fix. **PR #1 in the demo shop came from an `eve dev` run, not from prod.** Every live beat below depends on PRs that are still open:

| Beat | Needs merged + `npx eve deploy` by T-30 | Owner | If it isn't merged |
|---|---|---|---|
| Hire in the UI | #29 (web app), #30 (fitting room) | Martha | Fallback only: the PR #29 preview (SSO-protected, so sign in first) or screenshots |
| Chat in the browser | #33 (`none()` auth on the eve channel) | Santiago | Use `npx eve remote connect --url https://roary-rho.vercel.app` (a TUI that talks to prod, not a local server) |
| Triage report | Triage skill (#6/#7, in progress) | — | The prompt below is written to work without the skill, since it names every project |
| Fix PR | #32 (fix-error skill) | Santiago | Fallback only: show demo-shop PR #1 |
| Launch video | #31 (template, render tool, PR trigger) | Santiago | Fallback only: the pre-rendered video (**the Blob URL doesn't exist yet, see T-30**) |

After the last merge: `npx eve deploy`, then `npx eve info --json` on the deployed commit (0 diagnostics), then one full dry run (issue #19).

---

## 1. Roles and screen

- **Presenter (P):** talks and faces the judges. Proposed: Martha.
- **Driver (D):** keyboard and mouse only, and says nothing unless P hands over. Proposed: Santiago.
- One browser window, 125% zoom, dark-mode tabs in this order (Cmd+1 to Cmd+8):

| # | Tab | URL |
|---|---|---|
| 1 | Hire Roary (landing → `/hire`) | `https://roary-rho.vercel.app/hire` (after #29/#30 deploy) |
| 2 | Roary chat (`/desk`) | `https://roary-rho.vercel.app/desk`, or a terminal running `npx eve remote connect --url https://roary-rho.vercel.app` |
| 3 | Bug PR, "Add bundle discount for multi-item carts" | `https://github.com/scarranca/roary-demo-shop/pulls` (the open break PR, see `scripts/demo-reset.md` §B) |
| 4 | The shop | `https://roary-demo-shop.vercel.app` |
| 5 | Terminal: traffic command typed in, **not** run yet | see §3 |
| 6 | Sentry issues, project `javascript-nextjs-k4` | `https://roary.sentry.io/issues/?project=javascript-nextjs-k4` |
| 7 | PostHog project 665339, `checkout_failed` vs `checkout_completed` trend | `https://us.posthog.com/project/665339` |
| 8 | Fallback tab: demo-shop PR #1 + launch video Blob URL + dry-run screenshots | `https://github.com/scarranca/roary-demo-shop/pull/1` |

---

## 2. Pre-demo checklist

### T-30 min
- [ ] Merge gate (§0) done, `npx eve deploy` finished, `curl -s https://roary-rho.vercel.app/eve/v1/health` returns 200.
- [ ] **Shop is healthy:** `scripts/demo-reset.md` §A. Check: `npx tsx scripts/traffic.ts 10` against prod shows **0 failed**.
- [ ] **Break PR is open and ready** (not merged): `scripts/demo-reset.md` §B. Its Vercel preview check is green.
- [ ] **Feature PR for the launch video** is open in the demo shop, labeled `feature`. Example: "Free shipping banner over $50", a small UI-only change. **Merge it at T-5** so the render is done by 2:15.
- [ ] **Pre-rendered launch video:** render one from the #31 template, upload it to Blob, and paste the URL here: `TODO(Santiago): BLOB_URL`. Open it in tab 8.
- [ ] **Screen-record one full successful run** (QuickTime, 1080p) and keep it on the desktop. This is the last-resort fallback for everything.
- [ ] Seed Neon so the desk isn't empty: `npx tsx --env-file=.env.local scripts/seed-demo.ts` (only once triage testing on `incidents` is finished).
- [ ] Screenshot the dry run's triage report and fix PR. Put them in tab 8.

### T-10 min
- [ ] **Sign-ins.** GitHub (scarranca, with merge rights on roary-demo-shop), Sentry (org `roary`), PostHog, Vercel (team `roary-hack`).
- [ ] **Vercel Connect (Sentry is user-scoped).** In the exact chat surface you'll use on stage, ask Roary "List the 3 most recent Sentry issues in project javascript-nextjs-k4." If it posts a `connect.vercel.com/authorize/...` link, finish it now. Otherwise the link shows up mid-demo.
- [ ] Ask Roary the PostHog question once ("How many checkout_failed events in project 665339 in the last 24h?") so the MCP connection is warm.
- [ ] Open every tab from §1. Clear the chat (start a new session). Close Slack, mail and notifications (Do Not Disturb on).
- [ ] Terminal (tab 5): `cd ~/roary-demo-shop`, paste the traffic command, **don't press Enter**. Font size 18+.

### T-2 min
- [ ] Pre-warm, from a second terminal:
  ```bash
  curl -s -o /dev/null -w "roary %{http_code} %{time_total}s\n" https://roary-rho.vercel.app/eve/v1/health
  curl -s -o /dev/null -w "shop  %{http_code} %{time_total}s\n" https://roary-demo-shop.vercel.app/
  ```
  Both should return 200 in under 1s. If Roary is slow, send "hi" in the chat.
- [ ] Check that the feature PR (merged at T-5) has Roary's launch-video comment. If it doesn't, the video beat uses the Blob URL from tab 8.
- [ ] Tab 1 is on screen. Water. Breathe.

---

## 3. Run-of-show (3:00)

Durations are targets. Use the dry run (issue #19) to fill in real timings, and anything over 60s gets pre-staged.

| Time | Who | On screen | Action / words | Cutover rule → Fallback |
|---|---|---|---|---|
| **0:00–0:15** | P | Tab 1: Hire landing | **Hook:** "Every small team has the same 2am problem: something breaks, and four people open four tabs. We didn't build another dashboard. We hired a teammate. Meet Roary." | — |
| 0:00 | D | Tab 3 → back to tab 1 | **During the hook, D clicks "Merge" on the bug PR** ("Add bundle discount for multi-item carts"). Vercel starts the production deploy, which takes about 45–90s. | Merge button blocked → `gh pr merge <n> --repo scarranca/roary-demo-shop --merge` in tab 5. |
| **0:15–0:45** | P + D | Tab 1 → `/hire` fitting room | D: pick a character → personality preset → Jobs: Triage ON, Fix PRs ON, Launch videos ON. **Point at "Merge PRs" locked off.** Sign the offer letter → roar. P: "You don't configure Roary, you hire it: a name, a personality, a job description. One job is locked forever: merging. Humans merge." | UI fails or is slow (>5s) → screenshots in tab 8, or the PR #29 preview. Not merged at all → show `agent/instructions.md` Guardrails on GitHub. |
| **0:45–1:05** | D, then P | Tab 4 → tab 5 | D checks in the Vercel tab/toast that the deploy is **Ready**, then presses Enter on the traffic command. Output ends with something like `24/42 failed`. P: "We just shipped a bundle discount. Forty-two shoppers hit checkout, and most buy a single item…" | Deploy not Ready by 0:55 → P stretches ("…and that deploy just went out"), D waits up to 1:05, then runs it anyway. Still 0 failures → use the 2:05pm run ("24 of 42 failed") and tab 6 Sentry, which already holds the events from testing. |
| **1:05–1:50** | D types, P narrates | Tab 2: chat | D pastes **Prompt 1** (below). P narrates while the tool calls stream: "It's reading the stack trace in Sentry… now asking PostHog how many real shoppers hit it… now walking the GitHub history for the commit." When the report lands, P reads the **Impact**, **What I saw** and **What I think + confidence** lines aloud. | No tool call within 15s, or no report by 1:45 → P: "Here's the same report from our run 20 minutes ago" → screenshot in tab 8. Sentry sign-in link appears → skip to the screenshot (don't sign in on stage). |
| **1:50–2:15** | D types, P narrates | Tab 2 → new PR | D pastes **Prompt 2**. Roary opens the PR on a `roary/fix-*` branch with a regression test. P: "It doesn't just tell us. It opens the fix and a test that reproduces the crash, links the commit and asks a human to merge." **D clicks Merge.** P: "That's the only click a human had to make." | PR not open by 2:05 → tab 8: demo-shop PR #1 ("here's the PR Roary opened by itself this afternoon, with the regression tests"). Scroll the diff and the test. Don't merge anything in the fallback. |
| **2:15–2:45** | P | Feature PR → video | "And when we ship something good, Roary celebrates." Open the feature PR merged at T-5 and show Roary's comment with the video link. **Play the video** (20s, so let it run about 15s). | Comment missing or the video doesn't load in 5s → play the pre-rendered Blob URL from tab 8. No Blob URL → the screen recording, at the video section. |
| **2:45–3:00** | P | Tab 1 (or a closing card) | **Impact + close:** "Any team on Vercel, GitHub, Sentry and PostHog can hire Roary today, with one `eve deploy`. Roary doesn't replace your team. It's the teammate who never sleeps and always says thank you." | — |

**Global fallback:** if two beats in a row fail, D switches to the screen recording at the matching timestamp and P narrates over it. Say "this is the recording from our dry run."

### Prompts (paste exactly)

Keep them in a text file next to the terminal. Both prompts name every project, so they work with or without the triage/fix skills deployed.

**Prompt 1 (triage):**
```
Hey Roary, checkout on our shop looks broken since the last deploy (https://roary-demo-shop.vercel.app, repo scarranca/roary-demo-shop). Can you triage it? Use Sentry (org roary, project javascript-nextjs-k4) for the error and stack trace, PostHog project 665339 to count checkout_failed vs checkout_completed in the last hour, and GitHub to find the commit that introduced it. Give me your incident report.
```

**Prompt 2 (fix):**
```
Thanks Roary. Please open a fix PR in scarranca/roary-demo-shop with a regression test for single-item carts, linking the commit that caused it. Don't merge; I'll review.
```

**If a judge asks Roary to merge** (good to do on purpose if there's time):
```
Can you just merge it yourself?
```
Expected: a kind refusal plus an offer to check CI. This shows the guardrail live.

---

## 4. Post-demo reset (between rehearsals and before the final)

1. Close any PRs Roary opened during the run that weren't merged (GitHub UI, comment "demo reset").
2. Shop back to healthy: if the fix PR was merged on stage, the shop is already healthy. Check with `npx tsx scripts/traffic.ts 10` → 0 failed. If not, follow `scripts/demo-reset.md` §A.
3. Re-create the break PR: `scripts/demo-reset.md` §B.
4. Re-open a fresh `feature` PR for the next launch video (§2, T-30).
5. Neon: delete only rows created during the run (`scripts/demo-reset.md` §C). **Destructive.** Don't touch `SEED-` rows.
6. Start a new chat session so the next run starts clean.

---

## 5. Known risks (watch these in the dry run)

- **Merge gate.** Five open PRs (#29, #30, #31, #32, #33) and the triage PR stand between today's prod and the live path. Anything not merged by T-30 runs on its fallback only.
- **Sentry in the public chat.** Sentry auth is a *user-scoped* Vercel Connect connector. An anonymous browser session (`none()` auth from #33) has no Vercel user, so the Sentry MCP may fail or ask for sign-in. For the triage beat, prefer `eve remote connect` (your Vercel user via OIDC) or confirm at T-10 that `/desk` can reach Sentry.
- **Deploy time.** The live break depends on a Vercel production build (about 45–90s, not timed yet). Time it in the dry run. If it's over 60s, merge the break PR at T-1 instead and say "this just went out."
- **Fix PR time.** Not measured yet. A fix run makes several sequential GitHub calls (read files, branch, commit each file, open the PR), so it will probably overrun its 25s slot. Time it, and treat PR #1 as the expected fallback.
- **Launch video.** No pre-rendered Blob URL exists yet, and the PR trigger is in #31. That leaves the screen recording as the only fallback until it exists.
- **Shared data.** The triage agent is testing against `incidents` right now. Seeding and cleanup must wait until it's done.
