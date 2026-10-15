import { defineChannel, POST } from "eve/channels";
import { db, schema } from "../lib/db";
import { type IssueRef, issueFromPayload, sentryAppCredentials, verifySentrySignature } from "../lib/sentry-app";
import { claimIncident, findSentryInstallation, markSentryInstallationDisconnected } from "../lib/sentry-app-store";
import { getDemoWorkspace, SENTRY_WEBHOOK_AUTHENTICATOR } from "../lib/workspace";

// Sentry webhooks → headless triage sessions. Two senders share this URL, told apart by which
// client secret signs `sentry-hook-signature` (HMAC-SHA256(client secret, body)):
// 1. the demo shop's Internal Integration (SENTRY_WEBHOOK_SECRET) → the demo workspace, as before;
// 2. the PUBLIC Sentry App (SENTRY_CLIENT_SECRET, only with SENTRY_PUBLIC_INTEGRATION_ENABLED=1)
//    → the workspace that installed it, found by the payload's installation.uuid.
const MAX_BODY_BYTES = 1_000_000;

// event_alert payloads only carry the numeric issue id; resolve the short id when we have a token.
async function lookupShortId(issueId: string): Promise<string | undefined> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) return undefined;
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

function triageMessage(incidentKey: string, issue: IssueRef, reportOn: string): string {
  return (
    `Triage Sentry issue ${incidentKey} (numeric id ${issue.id}: ${issue.title})${issue.project ? ` in project ${issue.project}` : ""}. ` +
    `This was started automatically by a Sentry alert; nobody is watching this session, so ${reportOn}.`
  );
}

export default defineChannel({
  routes: [
    POST("/sentry/webhook", async (request, { from, waitUntil }) => {
      const demoSecret = process.env.SENTRY_WEBHOOK_SECRET;
      const publicApp = sentryAppCredentials();
      if (!demoSecret && !publicApp) return new Response("webhook not configured", { status: 503 });

      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        return new Response("invalid json", { status: 400 });
      }

      const signature = request.headers.get("sentry-hook-signature") ?? "";
      const resource = request.headers.get("sentry-hook-resource");
      const isDemo = demoSecret ? verifySentrySignature(raw, body, signature, demoSecret) : false;
      const isPublic = !isDemo && publicApp ? verifySentrySignature(raw, body, signature, publicApp.clientSecret) : false;
      if (!isDemo && !isPublic) return new Response("invalid signature", { status: 401 });

      const installationUuid = typeof body.installation?.uuid === "string" ? body.installation.uuid : undefined;

      if (isPublic) {
        // The grant code in installation.created is exchanged by the redirect callback
        // (/api/connect/sentry/callback), which knows the workspace; here it would be unbound.
        if (resource === "installation") {
          if (body.action === "deleted" && installationUuid) {
            const workspaceId = await markSentryInstallationDisconnected(installationUuid);
            return Response.json({ ok: true, disconnected: workspaceId !== null });
          }
          return Response.json({ ok: true });
        }
        // Unknown or uninstalled installations get a 200, so Sentry doesn't disable the webhook.
        const connection = installationUuid ? await findSentryInstallation(installationUuid) : undefined;
        if (!connection || connection.status !== "connected") return new Response("unknown installation", { status: 200 });
        const issue = issueFromPayload(resource, body);
        if (!issue) return new Response("ignored", { status: 200 });

        const incidentKey = issue.shortId ?? issue.id;
        const claimed = await claimIncident(connection.workspaceId, incidentKey, issue.title);
        if (!claimed) return new Response("already triaged", { status: 200 });

        const keyNote = claimed.key === incidentKey ? "" : ` Record it with save_incident under sentryIssueId \`${claimed.key}\`.`;
        waitUntil(
          from(`sentry-app-issue-${issue.id}-${claimed.id}`).send(
            triageMessage(incidentKey, issue, "post your incident report on GitHub if this workspace has GitHub connected, and save it with save_incident") + keyNote,
            {
              auth: {
                authenticator: SENTRY_WEBHOOK_AUTHENTICATOR,
                principalType: "service",
                principalId: `sentry:${installationUuid}`,
                // resolveWorkspace routes this turn to the installing workspace (agent/lib/workspace.ts).
                attributes: { sentry_app: "public", installation_uuid: installationUuid! },
              },
            },
          ),
        );
        return Response.json({ ok: true, issueId: issue.id, incident: claimed.key }, { status: 202 });
      }

      // ---- demo shop (Internal Integration), unchanged -------------------------------------
      const issue = issueFromPayload(resource, body);
      if (!issue) return new Response("ignored", { status: 200 });
      issue.shortId ??= await lookupShortId(issue.id);
      // Incidents are keyed by the Sentry short id (what humans and the skill use), numeric id as fallback.
      const incidentKey = issue.shortId ?? issue.id;

      // Atomic claim on the unique sentry_issue_id: Sentry retries and duplicate alerts start nothing.
      // This integration is the demo shop's Sentry, so its incidents belong to the demo workspace.
      const { id: workspaceId } = await getDemoWorkspace();
      const claimed = await db
        .insert(schema.incidents)
        .values({ sentryIssueId: incidentKey, title: issue.title, status: "investigating", workspaceId })
        .onConflictDoNothing({ target: schema.incidents.sentryIssueId })
        .returning({ id: schema.incidents.id });
      if (claimed.length === 0) return new Response("already triaged", { status: 200 });

      waitUntil(
        // One address per claim, so a re-claimed issue gets a fresh session instead of steering a parked one.
        from(`sentry-issue-${issue.id}-${claimed[0]!.id}`).send(triageMessage(incidentKey, issue, "post your incident report on GitHub"), {
          auth: {
            authenticator: SENTRY_WEBHOOK_AUTHENTICATOR,
            principalType: "service",
            principalId: `sentry:${installationUuid ?? "unknown"}`,
            attributes: {},
          },
        }),
      );
      return Response.json({ ok: true, issueId: issue.id, incident: incidentKey }, { status: 202 });
    }),
  ],
});
