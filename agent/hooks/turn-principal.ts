import { defineHook } from "eve/hooks";
import { storablePrincipal, turnPrincipal } from "../lib/turn-principal";

// Records who this turn runs for (current caller, else the session initiator: the same rule as
// workspaceForTurn), so the GitHub tools pick that workspace's credential (agent/extensions/github.ts).
export default defineHook({
  events: {
    "turn.started"(_event, ctx) {
      const principal = storablePrincipal(ctx.session.auth.current ?? ctx.session.auth.initiator);
      turnPrincipal.update(() => principal);
    },
  },
});
