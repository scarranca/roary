import { defineTool } from "eve/tools";
import { z } from "zod";

// App-level Sentry search so triage works in sessions with no signed-in user (the public
// /desk chat, Sentry alerts). Uses SENTRY_AUTH_TOKEN, same as get_sentry_issue.
const SENTRY_API = "https://sentry.io/api/0";

export default defineTool({
  description:
    "List the unresolved Sentry issues in a project, most frequent first, using Roary's app-level Sentry token. Use this when someone reports a problem (e.g. 'checkout is broken') without giving a Sentry issue id, then call get_sentry_issue on the matching one.",
  inputSchema: z.object({
    org: z.string().default("roary").describe("Sentry organization slug"),
    project: z.string().default("javascript-nextjs-k4").describe("Sentry project slug"),
    query: z.string().default("is:unresolved").describe("Sentry search query, e.g. 'is:unresolved checkout'"),
    statsPeriod: z.string().default("14d").describe("Time window, e.g. '24h' or '14d'"),
    limit: z.number().int().min(1).max(25).default(10).describe("Max issues to return"),
  }),
  async execute({ org, project, query, statsPeriod, limit }, ctx) {
    const token = process.env.SENTRY_AUTH_TOKEN;
    if (!token) return { error: "SENTRY_AUTH_TOKEN is not configured." };
    const params = new URLSearchParams({ query, statsPeriod, sort: "freq", limit: String(limit) });
    const res = await fetch(`${SENTRY_API}/projects/${org}/${project}/issues/?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctx.abortSignal,
    });
    if (!res.ok) return { error: `Sentry API ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const issues = (await res.json()) as Record<string, any>[];
    return {
      issues: issues.map((i) => ({
        id: String(i.id),
        shortId: String(i.shortId),
        title: String(i.title),
        culprit: String(i.culprit ?? ""),
        level: String(i.level ?? ""),
        firstSeen: String(i.firstSeen),
        lastSeen: String(i.lastSeen),
        eventCount: Number(i.count),
        userCount: Number(i.userCount ?? 0),
        permalink: String(i.permalink),
      })),
    };
  },
});
