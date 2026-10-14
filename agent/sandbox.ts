import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";
import { VercelSandbox } from "eve/sandbox/vercel";

// Vercel Sandbox in production; a lightweight pure-JS shell locally so nobody needs Docker or a VM.
export const environment = process.env.VERCEL
  ? VercelSandbox.environment()
  : JustBashSandbox.environment();

export default defineSandbox(() => environment.open());
