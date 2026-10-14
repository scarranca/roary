# Demo reset runbook

Exact commands to (A) make the demo shop healthy, (B) stage the live break, and (C) clean up Neon after a run. Used by [`docs/DEMO.md`](../docs/DEMO.md).

> ⚠️ **Don't run any of this while the shop is being used for testing.** As of 2:05pm PT the bug is intentionally live on `main` for triage testing. Check with the team first.
> Steps marked **🔴 DESTRUCTIVE** change shared state that's hard to undo. Read them twice.

## Current state (2:05pm PT, Oct 14)

| Thing | State |
|---|---|
| `scarranca/roary-demo-shop` `main` | `dcb2cb8` (healthy) → **`8d41418` "Add bundle discount for multi-item carts" (the bug)** |
| Production deploy | `8d41418`: single-item checkouts return 500 (`TypeError ... reading 'lineTotal'`). The last traffic run had 24 of 42 checkouts fail. |
| `demo/break-checkout` branch | Same commit as `main` (0 ahead, 0 behind). **The shop README's "git merge demo/break-checkout" is stale.** |
| Demo-shop PR #1 | Roary's fix (`roary/fix-checkout-linetotal`): guard + `lib/checkout.test.ts` + `npm test`. Open, based on `8d41418`. |

All commands run from a checkout of the demo shop: `cd ~/roary-demo-shop && git fetch origin && git checkout main && git pull`.

---

## A. Restore the shop to healthy

**Preferred: merge Roary's fix PR #1.** It keeps PR #1 valid as "Roary's first autonomous fix PR (merged)", leaves the bundle discount working for multi-item carts, and adds the regression test.

```bash
# 🔴 Changes production of the demo shop (redeploys main)
gh pr merge 1 --repo scarranca/roary-demo-shop --merge
```

Alternative (not chosen): `git revert 8d41418 && git push`. This also restores health, but PR #1 then conflicts, and we lose the "merged autonomous fix" story.

**Verify** (about 60–90s after merge, once Vercel shows the production deploy as Ready):

```bash
BASE_URL=https://roary-demo-shop.vercel.app \
NEXT_PUBLIC_POSTHOG_KEY=phc_sUhDqdJRYurdqGvDzhaAXaLcWjhAjzC84vY8zWS6uP6k \
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
npx tsx scripts/traffic.ts 10        # expect: 0 failed
```

If a later run merged a *different* fix (Roary's live PR on stage), the shop is already healthy. Just verify.

---

## B. Stage the live break (a PR you merge on stage)

The break is a PR that undoes the fix's guard, titled like the original feature, so on stage it reads as "a teammate shipped a bundle discount." It also removes the regression test, so the story stays "no test caught it."

```bash
git checkout main && git pull
FIX_SHA=$(git log --merges -1 --format=%H)          # the merge commit from step A (check it's the fix!)
git log -1 --format='%h %s' "$FIX_SHA"               # sanity-check before going on

# 🔴 Force-resets the demo/break-checkout branch (a branch only, not main)
git checkout -B demo/break-checkout
git revert --no-edit -m 1 "$FIX_SHA"
git commit --amend -m "Add bundle discount for multi-item carts"
git push --force-with-lease origin demo/break-checkout

gh pr create --repo scarranca/roary-demo-shop --base main --head demo/break-checkout \
  --title "Add bundle discount for multi-item carts" \
  --body "10% off the second line item when the cart has 2+ products."
git checkout main
```

**Don't merge it until the demo.** Wait for the PR's Vercel preview check to go green. On stage: click **Merge** (or `gh pr merge <n> --repo scarranca/roary-demo-shop --merge`).

Check the diff before the demo. It must bring back `lines[1].lineTotal` without a length guard:

```bash
gh pr diff <n> --repo scarranca/roary-demo-shop | grep -n "lines\[1\]"
```

**Emergency break (no build wait), humans only.** In the Vercel dashboard (roary-demo-shop → Deployments), promote the existing `8d41418` production deployment ("Promote to Production" / `vercel promote <deployment-url>`). It's instant, but `main` won't contain the bug, so Roary's "suspect commit" answer will point at history rather than the latest commit. Use it only if a build is stuck. Undo it by promoting the latest healthy deployment. (Roary itself must never promote or roll back. Its guardrails forbid it.)

---

## C. Clear demo rows from Neon (document only, don't run blind)

Roary writes `incidents` (via `save_incident`) and `launches`. Delete **only** rows created during the run, and **never** seeded rows (`SEED-` incidents, launches whose `deployment_url` starts with `https://seed.roary.demo/`).

1. Write down the demo start time in UTC **before** the run, e.g. `2026-10-14 23:10:00+00`.
2. Preview what would go:

```bash
neon psql production
```
```sql
SELECT id, sentry_issue_id, title, status, created_at FROM incidents
 WHERE created_at >= '2026-10-14 23:10:00+00' AND sentry_issue_id NOT LIKE 'SEED-%';
SELECT id, repo, pr_number, title, created_at FROM launches
 WHERE created_at >= '2026-10-14 23:10:00+00' AND coalesce(deployment_url, '') NOT LIKE 'https://seed.roary.demo/%';
```

3. 🔴 **DESTRUCTIVE: deletes production rows.** Run it only if the preview above lists exactly the demo rows, and only when nobody else (for example, the triage agent tests) is writing to these tables:

```sql
BEGIN;
DELETE FROM incidents
 WHERE created_at >= '2026-10-14 23:10:00+00' AND sentry_issue_id NOT LIKE 'SEED-%';
DELETE FROM launches
 WHERE created_at >= '2026-10-14 23:10:00+00' AND coalesce(deployment_url, '') NOT LIKE 'https://seed.roary.demo/%';
-- check the row counts, then:
COMMIT;   -- or ROLLBACK;
```

This is data cleanup (DML), not schema change. Schema stays in `drizzle/`.

### Seeded rows

```bash
npx tsx --env-file=.env.local scripts/seed-demo.ts            # add 3 past incidents + 2 past launches (idempotent)
npx tsx --env-file=.env.local scripts/seed-demo.ts --unseed   # 🔴 removes only the seeded rows
```
