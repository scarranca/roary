import type { IssueRef } from "./sentry-app";

// Shared by the Sentry webhook channels (agent/channels/sentry-webhook.ts for the demo shop and
// the public app, agent/channels/sentry-workspace-webhook.ts for a workspace's own integration).

/** event_alert payloads only carry the numeric issue id; resolve the short id with that sender's token. */
export async function lookupShortId(issueId: string, token: string | undefined | null): Promise<string | undefined> {
  if (!token || !/^\d{1,20}$/.test(issueId)) return undefined;
  try {
    const res = await fetch(`https://sentry.io/api/0/issues/${issueId}/`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as { shortId?: string }).shortId : undefined;
  } catch {
    return undefined;
  }
}

export function triageMessage(incidentKey: string, issue: IssueRef, reportOn: string): string {
  return (
    `Triage Sentry issue ${incidentKey} (numeric id ${issue.id}: ${issue.title})${issue.project ? ` in project ${issue.project}` : ""}. ` +
    `This was started automatically by a Sentry alert; nobody is watching this session, so ${reportOn}.`
  );
}
