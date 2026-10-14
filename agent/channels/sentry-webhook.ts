import { createHmac, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { db, schema } from "../lib/db";

// Sentry Internal Integration webhook → start a headless triage session.
// Sentry signs each request with HMAC-SHA256(client secret, body) in `sentry-hook-signature`.
const MAX_BODY_BYTES = 1_000_000;

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function verifySignature(raw: string, parsed: unknown, signature: string, secret: string): boolean {
  const sign = (payload: string) => createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  // Sentry's own examples sign JSON.stringify(body); check the raw bytes too in case they differ.
  return safeEqualHex(sign(raw), signature) || safeEqualHex(sign(JSON.stringify(parsed)), signature);
}

type IssueRef = { id: string; shortId?: string; title: string; project?: string };

// `issue` resource (action "created") or an `event_alert` from an issue alert rule action.
function issueFromPayload(resource: string | null, body: any): IssueRef | null {
  if (resource === "issue" && body?.action === "created" && body.data?.issue?.id) {
    const issue = body.data.issue;
    return { id: String(issue.id), shortId: issue.shortId, title: issue.title ?? "Untitled error", project: issue.project?.slug };
  }
  if (resource === "event_alert" && body?.data?.event?.issue_id) {
    const event = body.data.event;
    return { id: String(event.issue_id), title: event.title ?? "Untitled error", project: event.project_slug ?? undefined };
  }
  return null;
}

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

export default defineChannel({
  routes: [
    POST("/sentry/webhook", async (request, { from, waitUntil }) => {
      const secret = process.env.SENTRY_WEBHOOK_SECRET;
      if (!secret) return new Response("webhook not configured", { status: 503 });

      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        return new Response("invalid json", { status: 400 });
      }

      const signature = request.headers.get("sentry-hook-signature") ?? "";
      if (!signature || !verifySignature(raw, body, signature, secret)) {
        return new Response("invalid signature", { status: 401 });
      }

      const issue = issueFromPayload(request.headers.get("sentry-hook-resource"), body);
      if (!issue) return new Response("ignored", { status: 200 });
      issue.shortId ??= await lookupShortId(issue.id);
      // Incidents are keyed by the Sentry short id (what humans and the skill use), numeric id as fallback.
      const incidentKey = issue.shortId ?? issue.id;

      // Atomic claim on the unique sentry_issue_id: Sentry retries and duplicate alerts start nothing.
      const claimed = await db
        .insert(schema.incidents)
        .values({ sentryIssueId: incidentKey, title: issue.title, status: "investigating" })
        .onConflictDoNothing({ target: schema.incidents.sentryIssueId })
        .returning({ id: schema.incidents.id });
      if (claimed.length === 0) return new Response("already triaged", { status: 200 });

      const message =
        `Triage Sentry issue ${incidentKey} (numeric id ${issue.id}: ${issue.title})${issue.project ? ` in project ${issue.project}` : ""}. ` +
        `This was started automatically by a Sentry alert; nobody is watching this session, so post your incident report on GitHub.`;

      waitUntil(
        from(`sentry-issue-${issue.id}`).send(message, {
          auth: {
            authenticator: "sentry-webhook",
            principalType: "service",
            principalId: `sentry:${body.installation?.uuid ?? "unknown"}`,
            attributes: {},
          },
        }),
      );
      return Response.json({ ok: true, issueId: issue.id, incident: incidentKey }, { status: 202 });
    }),
  ],
});
