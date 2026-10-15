---
description: Use when asked what shipped and whether it hurt anything, e.g. "Review what shipped in the last 24 hours", "review launches", "launch review", "did yesterday's deploy break anything?". Lists merged PRs and deployed pushes, compares Sentry errors and PostHog usage before vs after each one, records the result and posts a launch report.
---

# Review launches

Goal: in about a minute, answer "what shipped and did it hurt anything?" with real numbers per change, a verdict and an explicit confidence. Fetch each thing once; if a tool fails, say what failed and keep going with what you have.

## Which stack: the workspace

The `[Workspace]` line says whose workspace this is and what it has connected. The tools below already use that workspace's GitHub repos, Sentry project and PostHog project; never pick an org, repo or token yourself.

- **Demo workspace** (guests): repo `scarranca/roary-demo-shop` (Vercel deploys `main` to production), Sentry `roary/javascript-nextjs-k4`, PostHog `665339`. Checkout events: `checkout_clicked`, `checkout_completed`, `checkout_failed`, plus `add_to_cart`. Never ask a guest to sign in.
- **A signed-in team:** if a tool returns `no_github_connection`, `no_sentry_connection` or `no_posthog_connection`, say which connection is missing (they add it in Roary's setup) and review with what's left. Never use the demo shop's data for them.

## 1. What shipped

`list_merged_prs` with `sinceHours` from the request (default 24). It returns merged PRs **and** commits pushed straight to the default branch, each with:

- `anchor`: the moment to compare around. It's the production deploy time when GitHub knows one (`anchorSource: production_deploy`), else the merge/commit time.
- `deploymentUrl`, `authors`, `url`.

Review merged PRs and pushes that have their own production deploy. Pushes without a deploy shipped with a later one: mention them under that deploy instead of reviewing them alone. If nothing shipped, say so in one line ("Quiet day: nothing merged or deployed in the last 24h.") and stop.

## 2. Errors and usage around each change

For each reviewed change (newest first, at most 5):

1. `sentry_error_delta` with `at` = the change's `anchor` (default 6h windows). Note `before.events → after.events`, `newIssues` (first seen after the deploy), `regressedIssues`, `worsenedIssues`.
2. `posthog_event_delta` with the same `at`. Pass the events that matter for the change (read the PR/commit title: checkout change → `checkout_completed`, `checkout_failed`); omit `events` if you're not sure. Check `totals.before`: 0 means there was no traffic before, so there's **no baseline**.
3. If total traffic moved a lot, compare rates, not raw counts (e.g. `checkout_failed / checkout_clicked` before vs after), and say so.

The windows are equal on both sides and clipped to now: a change deployed 1h ago compares 1h vs 1h. Under 30 minutes of "after" data means **too early to tell**.

## 3. Verdict and confidence

- **Looks bad, consider rollback:** a new or regressed Sentry issue with real volume (≥ 10 events) that started after the deploy **and** a failure event (`*_failed`, errors) up in PostHog, or a new issue with ≥ 50 events. Suggest the rollback; never do it. Say how a human can (Vercel dashboard → Deployments → promote the previous production deployment, or revert the commit) and offer a fix PR instead.
- **Watch this:** any new/regressed issue, errors up more than 1.5x, a failure event up, or a key usage event down more than 30%.
- **Healthy:** none of that.

Confidence:
- **High:** Sentry and PostHog both answered, they agree, at least 2h of "after" data, there was a baseline, and no other change shipped in the same window.
- **Medium:** one of those is missing (e.g. no baseline, or a second change in the window).
- **Low:** only one source answered, or several changes overlap so you can't tell which one moved the numbers.

Always say what would raise it (more time after the deploy, the stack trace pointing into the diff via `get_sentry_issue`, a baseline day).

## 4. Record it

`save_launch_review` once per reviewed change: `repo`, `prNumber` (or `sha` for a direct push), `title`, `deploymentUrl`, and a one-line `healthSummary` like "Looks bad, consider rollback (high confidence). Errors 0 → 50 (new JAVASCRIPT-NEXTJS-K4-1), checkout_failed 0 → 49." Do this before posting.

## 5. Post the launch report in chat

Use the **Launch report** template from your instructions, as Markdown (never in a code block):

- Header: `🚀 Launch review: <window, e.g. last 24h (Oct 14 03:59 → Oct 15 03:59 UTC)>`.
- **Shipped:** each change with its link and the people who shipped it. Thank them by name, blamelessly, even when the numbers look bad.
- **Health:** one bullet per change: errors `before → after` (+ new issue short ids with links), usage `before → after` for the events you checked, and the window (`6h before vs after the 20:43 UTC deploy`).
- **What I think:** the verdict, `Confidence: <high|medium|low>` and why. Keep **What I saw** (numbers) separate from **What I think** (interpretation).
- **Follow-ups:** e.g. "triage JAVASCRIPT-NEXTJS-K4-1", "open a fix PR", or "none, nice work".

Don't post on GitHub from a chat review unless someone asks you to; the chat report is the deliverable.
