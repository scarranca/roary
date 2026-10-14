import { defineTool } from "eve/tools";
import { z } from "zod";

// App-level Sentry access: Roary has no user-scoped Sentry connection, so this works in the
// public /desk chat and webhook-started triage alike. Needs SENTRY_AUTH_TOKEN with
// event:read, project:read, org:read.
const SENTRY_API = "https://sentry.io/api/0";

type Frame = { filename?: string; absPath?: string; lineNo?: number; colNo?: number; function?: string; inApp?: boolean; context?: [number, string][] };
type ExceptionValue = { type?: string; value?: string; stacktrace?: { frames?: Frame[] } };
type SentryEvent = {
  eventID?: string;
  dateCreated?: string;
  release?: { version?: string } | null;
  tags?: { key: string; value: string }[];
  entries?: { type: string; data: { values?: ExceptionValue[] } }[];
};

async function sentryGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${SENTRY_API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw new Error(`Sentry API ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export default defineTool({
  description:
    "Fetch one Sentry issue plus its latest event's exception and in-app stack frames (with source context) using Roary's app-level Sentry token. Use this first when triaging a Sentry issue, especially in sessions started automatically by a Sentry alert.",
  inputSchema: z.object({
    issueId: z.string().describe("Sentry issue id (numeric, e.g. '6912345678') or short id (e.g. 'JAVASCRIPT-NEXTJS-K4-1')"),
    org: z.string().default("roary").describe("Sentry organization slug"),
  }),
  async execute({ issueId, org }, ctx) {
    const token = process.env.SENTRY_AUTH_TOKEN;
    if (!token) return { error: "SENTRY_AUTH_TOKEN is not configured." };
    const signal = ctx.abortSignal;

    let id = issueId;
    if (!/^\d+$/.test(issueId)) {
      const resolved = await sentryGet<{ groupId: string }>(`/organizations/${org}/shortids/${encodeURIComponent(issueId)}/`, token, signal);
      id = resolved.groupId;
    }

    const issue = await sentryGet<Record<string, any>>(`/organizations/${org}/issues/${id}/`, token, signal);
    const event = await sentryGet<SentryEvent>(`/organizations/${org}/issues/${id}/events/latest/`, token, signal);

    const exceptions = (event.entries ?? [])
      .filter((e) => e.type === "exception")
      .flatMap((e) => e.data.values ?? [])
      .map((ex) => {
        const frames = ex.stacktrace?.frames ?? [];
        const inApp = frames.filter((f) => f.inApp);
        // Sentry orders frames oldest-first; the crashing frame is last.
        const top = (inApp.length ? inApp : frames).slice(-5).reverse();
        return {
          type: ex.type,
          value: ex.value,
          frames: top.map((f) => ({
            file: f.filename ?? f.absPath,
            line: f.lineNo,
            function: f.function,
            inApp: f.inApp ?? false,
            context: f.context?.map(([n, code]) => `${n}: ${code}`).join("\n"),
          })),
        };
      });

    // Plain JSON only: drop undefined fields so eve can serialize the result.
    return JSON.parse(JSON.stringify({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      status: issue.status,
      level: issue.level,
      project: issue.project?.slug,
      permalink: issue.permalink,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      eventCount: Number(issue.count),
      userCount: issue.userCount,
      latestEvent: {
        id: event.eventID,
        at: event.dateCreated,
        release: event.release?.version ?? null,
        url: event.tags?.find((t) => t.key === "url")?.value ?? null,
        exceptions,
      },
    }));
  },
});
