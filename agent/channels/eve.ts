import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Public demo: anyone with the URL can chat with Roary from the browser.
    // Roary never merges or changes settings, but anonymous visitors spend
    // model credits. Replace with a real authenticator in #22.
    none(),
  ],
});
