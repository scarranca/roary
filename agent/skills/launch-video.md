---
description: Use when a feature PR was merged (a pull_request closed+merged event with the `feature` or `launch` label) or someone asks for a launch video, e.g. "@roary make a launch video for PR #42". Reads the PR, writes the copy, renders the video and posts it on the PR with a thank-you.
---

# Launch video

Celebrate a shipped feature with a ~20s branded video and post it on the PR.

## 1. Find the PR

- From a merge event, the PR number and repo are in the GitHub context.
- From a comment ("make a launch video for PR #42"), use that number in the current repo. If no number is given and you are on a PR thread, use that PR.
- Only make a video for a **merged** PR. If it isn't merged yet, say so in one line and offer to make it after the merge.

## 2. Read it (no guessing)

Use `github__getPullRequest` and `github__listPullRequestFiles` (or the PR diff already in your context). Collect:
- what the feature does for users (title, body, linked issue)
- the people who shipped it: the PR author plus co-authors and reviewers who contributed commits, as GitHub handles
- any real number in the PR (latency, steps, size, conversion). Never invent metrics.

## 3. Write the copy

Punchy, warm, user-facing. No jargon, no file names, no blame. Respect the length limits in the `render_launch_video` schema.
- `title`: the feature name in 2-5 words ("One-tap checkout"), not the PR title verbatim.
- `tagline`: one sentence on what users can now do.
- `bullets`: exactly three benefits, each under 60 characters, strongest first.
- `metricLabel` / `metricBefore` / `metricAfter`: a real before/after from the PR. If there is none, use an honest qualitative pair, e.g. label "Steps to export", "5" → "1" only if the PR shows it; otherwise "Status", "Requested" → "Shipped".
- `impact`: one line on who benefits.
- `product`: the repo name (owner/name) unless the PR names the product.

## 4. Render

Call `render_launch_video` once with the copy. It takes a few minutes; don't call it twice for the same PR in one turn. If it fails, say so plainly with the error summary and offer to retry. Don't post a link you didn't get back from the tool.

## 5. Post on the PR

Your reply in the PR thread is the comment. Keep it short:

```
🦁🎬 **<Feature title> just shipped!**

<one line on why it matters for users>

▶️ **Launch video:** <videoUrl>

Huge thanks to @<handle>, @<handle> for shipping this. 🧡
```

If you are not in the PR thread (for example the request came from another channel), post the same message with `github__addIssueComment` on the PR and share the link where you were asked.
