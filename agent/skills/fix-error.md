---
description: Use when asked to fix an incident or error, propose a fix, open a fix PR, or when someone says "@roary fix this" on an incident issue or comment. Turns a diagnosed incident into a minimal patch + regression test on a new branch and opens a PR that a human merges.
---

# Fix an incident with a PR

Goal: one small, reviewable PR that fixes the diagnosed bug, adds a regression test that would have caught it, links the incident, and is left open for a human to merge.

Work only through the `github__*` tools. Do **not** clone, and do not run `git`, `npm` or tests in the sandbox: the local sandbox can't run them. The PR's checks (the Vercel preview build) are the CI signal.

## 1. Gather the incident

You need: **repo** (`owner/name`), **culprit file(s)**, **suspect commit**, **base branch**, and the **Sentry issue id** if there is one.

- From a triage run or the user's message: use what you were given.
- From the record: call `list_incidents` and pick the matching row. Carry forward its `title`, `diagnosis` and `suspectCommit`.
- From "@roary fix this" on a GitHub issue or comment: read it with `github__getIssueContext` (and `github__listIssueComments` if the incident report is in a comment). Pull repo, file, commit and Sentry id out of the incident report. Note the issue number: the PR will close it.
- Not diagnosed yet (no culprit file or line)? Load the `triage-error` skill and run it first, or ask for the missing piece. Don't guess at a fix.

**Base branch:** the branch where the suspect commit lives. If the user names a base, use it. Otherwise check with `github__getCommit` / `github__listBranches`, and fall back to the repo's default branch.

## 2. Read before you write

- `github__getFileContent` on each culprit file at the base branch (`ref: <base>`). Keep the returned `sha`: you need it to update the file.
- `github__getCommit` on the suspect commit to see exactly what changed. The fix usually undoes or guards that change.
- `github__getFileContent` on `package.json` (keep its `sha`) to see the test setup: is there a `test` script, which runner, is `tsx` installed? Look for existing `*.test.ts` files next to the code.

## 3. Write the patch and the test

**Patch:** the smallest change that fixes the root cause. Keep the original intent of the change (for example, keep a new discount but only apply it when it's valid). No refactors, renames or formatting churn.

**Regression test:** next to the code, e.g. `lib/checkout.ts` → `lib/checkout.test.ts`.

- One test that reproduces the incident (the input that crashed now works and gives the right result).
- One test that the intended behavior still works (so the fix isn't a no-op).
- If the repo already has a test runner, use it and its style.
- If it has none: use `node:test` + `node:assert/strict` and add one script to `package.json`. Use `"test": "tsx --test <dir>/*.test.ts"` if `tsx` is already a dependency, otherwise `"test": "node --test"`.
- **Never add or upgrade dependencies through the API.** The lockfile can't be updated that way and the preview build (`npm ci`) would fail.

Double-check the test against the patched code in your head: imports match the repo (extensionless imports need `tsx`), prices and units match the source (e.g. cents), expected numbers are computed from the real constants.

## 4. Branch, commit, open the PR

1. `github__createBranch` with `branch: "roary/fix-<incident-slug>"` (lowercase, dashes, e.g. `roary/fix-checkout-linetotal` or `roary/fix-demo-shop-12`) and `from: <base branch>`. If it already exists, add a short suffix.
2. `github__createOrUpdateFile` once per file, **one call at a time** (each commit moves the branch head, so parallel calls conflict):
   - **Always pass `branch: "roary/fix-…"`.** Never commit to `main`/`master`, even if that's the base.
   - Pass the `sha` from step 2 when updating an existing file; omit it for new files.
   - Commit messages: short and imperative, e.g. `Only apply bundle discount to multi-item carts`, `Add regression test for single-item checkout`.
3. `github__createPullRequest` with `head: "roary/fix-…"`, `base: <base branch>`, a title like `Fix: <what users hit>`, and a body that follows the **PR description** template in your instructions:
   - **What:** the change in one or two lines.
   - **Why:** what broke and who it affected, with counts (users/events from the incident, Sentry or PostHog; say "unknown" rather than invent), the suspect commit as a link (`https://github.com/<owner>/<repo>/commit/<sha>`), and the Sentry issue link if you have one (get the permalink from Sentry; never make up a URL). Add `Closes #<n>` when there is an incident issue in the same repo.
   - **How I tested it:** the regression test you added, what it covers, and that it fails on the old code with the incident's error. Say honestly that you did not run it yourself and that the PR checks are the signal; reviewers can run `npm test`.
   - **Confidence:** high/medium/low and what reviewers should look at.
   - End with the template's "Opened by Roary" line.

## 5. Record it and report back

- `save_incident` with `status: "fix_proposed"` and `prUrl`, plus the carried-forward `title`, `diagnosis`, `suspectCommit` and `usersAffected`. `sentryIssueId` is the Sentry id; if there is none, use a stable key like `<repo-name>#<issue-number>` or `<repo-name>:<short-slug>` and reuse it for the same incident. Never invent a Sentry-looking id.
- From "@roary fix this": reply on that issue with `github__addIssueComment`: one line, the PR link, and that a human needs to review and merge.
- In chat: the PR link, the one-line fix, and what still needs a human (review, merge; merging and deploying resolves the Sentry issue).

## Never

- Never merge, close, force-push or delete branches. Humans merge.
- Never commit to the default branch or the base branch directly.
- If you can't find the cause with confidence, don't open a speculative PR: post the suspected fix as a comment and ask.
