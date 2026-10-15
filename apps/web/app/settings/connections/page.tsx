import type { Metadata } from "next";
import { ConnectStack } from "../../_components/connect-stack";
import { SiteHeader } from "../../_components/site-header";

export const metadata: Metadata = { title: "Connections" };

// Outcomes of the GitHub App round trip (/api/connect/github/callback).
const GITHUB_NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "GitHub connected. Roary can see the repos you picked." },
  pending: { ok: true, text: "Install requested. An org owner has to approve it on GitHub." },
  signin: { ok: false, text: "Sign in first, then install Roary on your repos." },
  unavailable: { ok: false, text: "Connections aren't set up on this server yet." },
  error: { ok: false, text: "GitHub install didn't finish." },
};

// Failure details worth saying in words; anything else is shown as its code.
const GITHUB_ERROR_DETAILS: Record<string, string> = {
  claimed: "That GitHub installation is already connected to another Roary workspace.",
  not_your_installation: "Your GitHub account can't access that installation.",
  state_expired: "The install link expired. Start again.",
  state_browser: "Finish the install in the same browser you started it in.",
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { github, detail } = await searchParams;
  const base = github ? GITHUB_NOTICES[github] : undefined;
  const explained = github === "error" && detail ? GITHUB_ERROR_DETAILS[detail] : undefined;
  const notice = base && explained ? { ok: false, text: explained } : base;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-3">
          <h1 className="quoted type-display text-5xl sm:text-6xl">Connect your stack</h1>
          <p className="font-mono text-muted-foreground text-sm uppercase">
            Where Roary works: your repos, your errors, your analytics. Keys are checked live and stored encrypted.
          </p>
        </div>
        <ConnectStack
          notice={
            notice ? (
              <p
                className={
                  notice.ok
                    ? "rounded-[3px] border-2 border-ok bg-ok-soft p-3 font-mono text-ok text-xs uppercase"
                    : "rounded-[3px] border-2 border-broken bg-broken-soft p-3 font-mono text-broken text-xs uppercase"
                }
                role="status"
              >
                {notice.text}
                {detail && !notice.ok && !explained ?` (${detail.replace(/[^a-z0-9_]/gi, "")})` : null}
              </p>
            ) : null
          }
        />
      </main>
    </div>
  );
}
