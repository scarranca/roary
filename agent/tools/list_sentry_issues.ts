import { defineTool } from "eve/tools";
import { z } from "zod";
import { sentryAccess } from "../lib/sentry-access";

// Sentry search against the Sentry project this turn's workspace connected. Guests use the demo
// workspace (org `roary`, project `javascript-nextjs-k4`, app-level SENTRY_AUTH_TOKEN).
const SENTRY_API = "https://sentry.io/api/0";

export default defineTool({
  description:
    "List the unresolved Sentry issues in this workspace's connected Sentry project, most frequent first. Use this when someone reports a problem (e.g. 'checkout is broken') without giving a Sentry issue id, then call get_sentry_issue on the matching one. The org and project come from the workspace's Sentry connection; if it returns no_sentry_connection, tell the person to connect Sentry instead of guessing.",
  inputSchema: z.object({
    query: z.string().default("is:unresolved").describe("Sentry search query, e.g. 'is:unresolved checkout'"),
    statsPeriod: z.string().default("14d").describe("Time window, e.g. '24h' or '14d'"),
    limit: z.number().int().min(1).max(25).default(10).describe("Max issues to return"),
  }),
  async execute({ query, statsPeriod, limit }, ctx) {
    const access = await sentryAccess(ctx);
    if (!access.ok) return { error: access.error, message: access.message };
    if (!access.project) return { error: "no_sentry_project", message: "The workspace's Sentry connection has no project selected yet." };
    const params = new URLSearchParams({ query, statsPeriod, sort: "freq", limit: String(limit) });
    const res = await fetch(`${SENTRY_API}/projects/${access.org}/${access.project}/issues/?${params}`, {
      headers: { authorization: `Bearer ${access.token}` },
      signal: ctx.abortSignal,
    });
    if (!res.ok) return { error: `Sentry API ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const issues = (await res.json()) as Record<string, any>[];
    return {
      org: access.org,
      project: access.project,
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
