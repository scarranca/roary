import { eq } from "drizzle-orm";
import { defineChannel, POST } from "eve/channels";
import { db, schema } from "../lib/db";
import { claimDelivery, loadWebhookTarget, releaseDelivery } from "../lib/quick-connect";
import { sentryInternalConfig } from "../lib/quick-connect-config";
import { issueFromPayload, verifySentrySignature } from "../lib/sentry-app";
import { claimIncident } from "../lib/sentry-app-store";
import { lookupShortId, triageMessage } from "../lib/sentry-triage";
import { claimTurnOwner, recordStepSpend } from "../lib/session-events";
import { admitWebhookMessage } from "../lib/usage-limits";
import { credentialFor, SENTRY_WEBHOOK_AUTHENTICATOR } from "../lib/workspace";

// Quick connect: a team's OWN Sentry internal integration (no public app, no Sentry review).
// Webhook URL /sentry/webhook/<workspace public id>; `sentry-hook-signature` is checked with THAT
// workspace's client secret, the issue is claimed per workspace, and triage starts in that
// workspace. The demo shop's /sentry/webhook and the public app path (agent/channels/sentry-webhook.ts)
// are separate and unchanged.
const MAX_BODY_BYTES = 1_000_000;

export default defineChannel({
  routes: [
    POST("/sentry/webhook/:publicId", async (request, { from, waitUntil, params }) => {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
      const target = await loadWebhookTarget(params.publicId ?? "", "sentry");
      if (!target) return new Response("not found", { status: 404 });

      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      if (!verifySentrySignature(raw, body, request.headers.get("sentry-hook-signature") ?? "", target.secret)) {
        return new Response("invalid signature", { status: 401 });
      }

      const { workspace, connection } = target;
      const resource = request.headers.get("sentry-hook-resource");
      // installation webhooks and anything that isn't a new issue / alert: acknowledged, nothing starts.
      const issue = issueFromPayload(resource, body);
      if (!issue) return Response.json({ ok: true, ignored: true });

      // Sentry's per-delivery id: a retried or replayed delivery starts nothing.
      const delivery = request.headers.get("request-id");
      if (delivery && !(await claimDelivery(workspace.id, "sentry", delivery))) return Response.json({ ok: true, duplicate: true });

      const resolved = { workspace, connections: [connection] };
      // event_alert carries only the numeric id: look the short id up with THIS workspace's token.
      issue.shortId ??= await lookupShortId(issue.id, await credentialFor(resolved, connection, undefined).catch(() => null));
      const incidentKey = issue.shortId ?? issue.id;
      const claimed = await claimIncident(workspace.id, incidentKey, issue.title);
      if (!claimed) return Response.json({ ok: true, duplicate: "already triaged" });

      // Undo both claims when nothing starts, so a redelivery (or the issue's next alert) triages it.
      const unclaim = async () => {
        await db.delete(schema.incidents).where(eq(schema.incidents.id, claimed.id));
        if (delivery) await releaseDelivery(workspace.id, "sentry", delivery);
      };
      const decision = await admitWebhookMessage(workspace.id);
      if (!decision.ok) {
        // 200, not 429: Sentry disables webhooks that keep failing.
        await unclaim();
        return Response.json({ ok: false, reason: "rate_limited", message: decision.message, resetsAt: decision.resetsAt.toISOString() });
      }

      const config = sentryInternalConfig(connection)!;
      const keyNote = claimed.key === incidentKey ? "" : ` Record it with save_incident under sentryIssueId \`${claimed.key}\`.`;
      waitUntil(
        from(`sentry-ws-${workspace.publicId}-issue-${issue.id}-${claimed.id}`).send(
          triageMessage(
            incidentKey,
            issue,
            `use this workspace's Sentry org \`${config.org}\`, post your incident report on GitHub if this workspace has GitHub connected, and save it with save_incident`,
          ) + keyNote,
          {
            auth: {
              authenticator: SENTRY_WEBHOOK_AUTHENTICATOR,
              principalType: "service",
              principalId: `sentry-internal:${workspace.publicId}`,
              // resolveWorkspace routes this turn to exactly this workspace (agent/lib/workspace.ts).
              attributes: { sentry_app: "internal", workspace_public_id: workspace.publicId },
            },
          },
        )
          .catch(async (error: unknown) => {
            console.warn("sentry quick-connect triage not started", { error: error instanceof Error ? error.name : "unknown" });
            await unclaim().catch(() => undefined);
          }),
      );
      return Response.json({ ok: true, issueId: issue.id, incident: claimed.key }, { status: 202 });
    }),
  ],
  events: {
    "turn.started": (_data, _channel, ctx) => claimTurnOwner(ctx),
    "step.completed": (data, _channel, ctx) => recordStepSpend(data, ctx),
  },
});
