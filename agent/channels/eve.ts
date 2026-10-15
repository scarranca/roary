import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";
import { neonAuth } from "../lib/neon-auth";
import { workspaceContext } from "../lib/workspace-context";

export default eveChannel({
  auth: [
    // Signed-in Roary users (Neon Auth JWT as a bearer): their own workspace.
    neonAuth(),
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Public demo: anyone with the URL can chat with Roary from the browser and gets the
    // demo workspace. Roary never merges or changes settings, but anonymous visitors spend
    // model credits.
    none(),
  ],
  // Tell Roary which workspace this turn runs in and what it is connected to, so a signed-in
  // team with nothing connected hears that instead of getting the demo shop's data.
  async onMessage(ctx) {
    return { auth: defaultEveAuth(ctx), context: [await workspaceContext(ctx.eve.caller)] };
  },
});
