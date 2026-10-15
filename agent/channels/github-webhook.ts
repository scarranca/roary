import { defineChannel, POST } from "eve/channels";
import { type GithubWebhookPayload, planGithubEvent } from "../lib/github-pat-webhook";
import { claimDelivery, loadWebhookTarget, releaseDelivery, verifyGithubSignature } from "../lib/quick-connect";
import { GITHUB_PAT_WEBHOOK_AUTHENTICATOR, githubPatConfig } from "../lib/quick-connect-config";
import { claimTurnOwner, recordStepSpend } from "../lib/session-events";
import { admitWebhookMessage } from "../lib/usage-limits";
import { workspaceContext } from "../lib/workspace-context";

// Quick connect: a team's OWN GitHub repo webhook (they connected GitHub with a personal access
// token, no GitHub App). Payload URL /github/webhook/<workspace public id>, signed with that
// workspace's secret (X-Hub-Signature-256). Same jobs as the App channel (agent/channels/github.ts):
// `@roary` mentions answered on the thread (posting as the token's user) and launch videos for
// merged `feature`/`launch` PRs; see agent/lib/github-pat-webhook.ts. Unlike eve's githubChannel
// there's no eyes reaction, PR-diff context or sandbox checkout: Roary uses the github__* tools.
const MAX_BODY_BYTES = 1_000_000;

export default defineChannel({
  routes: [
    POST("/github/webhook/:publicId", async (request, { from, waitUntil, params }) => {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
      const target = await loadWebhookTarget(params.publicId ?? "", "github");
      if (!target) return new Response("not found", { status: 404 });
      if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"), target.secret)) {
        return new Response("invalid signature", { status: 401 });
      }

      const event = request.headers.get("x-github-event");
      if (event === "ping") return Response.json({ ok: true, pong: true });
      let body: GithubWebhookPayload;
      try {
        body = JSON.parse(raw) as GithubWebhookPayload;
      } catch {
        return new Response("invalid json (set the webhook's content type to application/json)", { status: 400 });
      }

      const { workspace, connection } = target;
      const config = githubPatConfig(connection)!;
      if (connection.status !== "connected") return Response.json({ ok: true, ignored: "github_not_connected" });
      const repo = body.repository?.full_name?.toLowerCase();
      if (!repo || !config.repos.some((r) => r.toLowerCase() === repo)) return Response.json({ ok: true, ignored: "repo_not_connected" });
      const plan = planGithubEvent(event, body, workspace.publicId, config.login);
      if (!plan) return Response.json({ ok: true, ignored: true });

      const delivery = request.headers.get("x-github-delivery");
      if (delivery && !(await claimDelivery(workspace.id, "github", delivery))) return Response.json({ ok: true, duplicate: true });

      const decision = await admitWebhookMessage(workspace.id);
      if (!decision.ok) {
        // 200, not 429, so GitHub doesn't flag the hook; release the claim so a manual redeliver works later.
        if (delivery) await releaseDelivery(workspace.id, "github", delivery);
        return Response.json({ ok: false, reason: "rate_limited", message: decision.message, resetsAt: decision.resetsAt.toISOString() });
      }

      const auth = {
        authenticator: GITHUB_PAT_WEBHOOK_AUTHENTICATOR,
        principalType: "service" as const,
        principalId: `github:${body.sender?.login ?? "unknown"}`,
        // resolveWorkspace routes this turn to exactly this workspace (agent/lib/workspace.ts).
        attributes: { workspace_public_id: workspace.publicId, github_login: body.sender?.login ?? "" },
      };
      const context = await workspaceContext(auth);
      waitUntil(
        from(plan.address)
          .send(`${context}\n\n${plan.message}`, { auth })
          .catch(async (error: unknown) => {
            // Nothing started: forget the delivery so GitHub's "Redeliver" can try again.
            console.warn("github quick-connect session not started", { error: error instanceof Error ? error.name : "unknown" });
            if (delivery) await releaseDelivery(workspace.id, "github", delivery).catch(() => undefined);
          }),
      );
      return Response.json({ ok: true, started: plan.title }, { status: 202 });
    }),
  ],
  events: {
    "turn.started": (_data, _channel, ctx) => claimTurnOwner(ctx),
    "step.completed": (data, _channel, ctx) => recordStepSpend(data, ctx),
  },
});
