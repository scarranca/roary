---
description: Use when asked to triage, investigate or diagnose a Sentry error or issue, or when a message starts with "Triage Sentry issue". Finds the root cause, the users affected and the suspect commit, records the incident and posts an incident report on GitHub.
---

# Triage a Sentry error

Goal: in under 2 minutes, go from a Sentry issue to a posted incident report with the root cause, the number of users hit, the suspect commit and an explicit confidence. Work fast: fetch each thing once, do at most one widened search per step, and if a tool fails twice, say what failed and move on with what you have. Don't call Seer (`sentry__analyze_issue_with_seer`); it's slow and you don't need it.

## Defaults for this team

- Sentry: org `roary`, project `javascript-nextjs-k4`.
- App repo: `scarranca/roary-demo-shop` (default branch `main`, deployed to production on Vercel from `main`).
- PostHog: project `665339` (US). Checkout events: `checkout_clicked`, `checkout_completed`, `checkout_failed` (props `status`, `item_count`), plus `add_to_cart`.

If the issue clearly belongs to another project or repo, use that instead and say so.

## 1. Check for duplicate work

Call `list_incidents` (limit 20) and look for this Sentry issue id.

- Status `diagnosed`, `fix_proposed` or `resolved`: it's already been triaged. Don't redo it. Reply with a one-line summary of the existing record (and its GitHub issue if you can find it), unless someone explicitly asked you to re-triage.
- Status `investigating` with no diagnosis: that's the claim the Sentry alert trigger wrote when it started this session. Carry on.
- Not found: carry on.

## 2. Read the error in Sentry

Call `get_sentry_issue` with the issue id (numeric id or short id). It returns the title, culprit, first/last seen, event and user counts, the permalink and the top in-app stack frames with source context.

If it reports that the token is missing or fails, use the Sentry MCP tools instead: `sentry__get_sentry_resource` for the issue and its latest event, or `sentry__search_issues` if you only have a title. If neither works (for example `principal_required` in an automatic session), say so in the report and continue with what the trigger message told you.

From the top in-app frame, note: **file path, line, function, the failing expression**, and `firstSeen`.

If the issue doesn't exist or Sentry has no matching unresolved issue, say so in one line and stop. Don't post anything on GitHub.

## 3. Measure user impact in PostHog

Use `posthog__exec` against project 665339 to count distinct users hit since the error started. Prefer one HogQL query, for example:

```sql
SELECT
  countIf(event = 'checkout_failed') AS failed_events,
  uniqIf(distinct_id, event = 'checkout_failed') AS users_failed,
  uniqIf(distinct_id, event = 'checkout_clicked') AS users_tried,
  uniqIf(distinct_id, event = 'checkout_completed') AS users_completed
FROM events
WHERE timestamp >= toDateTime('<firstSeen minus 10 minutes, UTC>')
```

Pick the events that match the failing flow (checkout errors → `checkout_failed`). If PostHog fails or the flow has no matching event, use Sentry's `userCount` and say which source the number came from. Report counts only, never user identities.

## 4. Find the suspect commit on GitHub

Repo `scarranca/roary-demo-shop`:

1. Map the stack frame to a repo path (strip prefixes like `webpack-internal:///`, `app:///`, `./`, `.next/server/`; e.g. `lib/checkout.ts`).
2. `github__listCommits` with `path` set to that file (and `until` = firstSeen if helpful). The suspect is the most recent commit to that file **before** `firstSeen`.
3. `github__getCommit` on it and check whether its diff touches the failing line or expression. Note the commit SHA, message, author and time.
4. Optionally `github__listPullRequests` (state `closed`) to find the PR that merged it.
5. Deploy time: there's no Vercel connection yet, so use the commit time on `main` as the deploy proxy and say "deploy time unavailable; using commit time vs first seen".

Explain the mechanism in plain English (e.g. "the change reads the second cart line, which doesn't exist when the cart has one item, so `lineTotal` of undefined throws").

## 5. Decide confidence

- **High:** one commit changed that file shortly before `firstSeen` and its diff touches the failing line/expression.
- **Medium:** the file matches but there are several candidate commits, or the diff is near but not on the failing line.
- **Low:** no stack trace, no commit to that file in the window, or the cause is outside the repo (infra, third party).

Always say why, and what would raise it.

## 6. Record it

Call `save_incident` with `sentryIssueId` (the same id you were given), `title`, `status: "diagnosed"`, `usersAffected`, `diagnosis` (what you saw vs what you think, 2 to 4 sentences, with the confidence) and `suspectCommit` (full or short SHA). Do this before posting so the record exists even if GitHub fails.

## 7. Post the incident report on GitHub

1. `github__searchIssues` in `scarranca/roary-demo-shop` for the Sentry short id (or numeric id). If an open issue exists, `github__addIssueComment` with the report.
2. Otherwise `github__createIssue` titled `[Roary] <error title> (<SHORT-ID>)` with the report as the body.

Use the **Incident report** template from your instructions exactly. Fill it with:

- **Impact:** users affected (and of how many who tried), since `firstSeen`, which flow.
- **What I saw:** the error with the Sentry permalink, the top frame (`file:line`), the suspect commit with its link `https://github.com/scarranca/roary-demo-shop/commit/<sha>` and time, the key numbers.
- **What I think:** the mechanism and `Confidence: <high|medium|low> because <reason>`.
- **Suggested next step:** the concrete fix (a short code suggestion is great), and offer to open a fix PR. Needs a human for: reviewing/merging the fix, or reverting/rolling back the deploy if they prefer.

Blameless: talk about "the change" or "this commit", not the person. Don't paste secrets or user identities.

## 8. Reply

Finish with a 2 to 3 line summary: root cause, users affected, suspect commit, confidence, and the GitHub issue link. If this session was started automatically by a Sentry alert, nobody is reading the chat, so the GitHub issue is the deliverable.
