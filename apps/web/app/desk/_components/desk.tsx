import { AgentChat } from "../../_components/agent-chat";
import { SiteHeader } from "../../_components/site-header";
import { ActivityFeed } from "./activity-feed";
import { DeskTitle } from "./desk-title";

export function Desk({ sessionId }: { readonly sessionId?: string }) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:min-h-0 lg:grid-cols-[1fr_1.15fr]">
        <section aria-labelledby="feed-title" className="flex min-w-0 flex-col gap-6 lg:overflow-y-auto">
          <DeskTitle />
          <ActivityFeed />
        </section>
        <section
          aria-label="Chat with Roary"
          className="h-[75dvh] min-w-0 overflow-hidden rounded-[3px] border-2 border-ink lg:h-auto"
        >
          <AgentChat sessionId={sessionId} />
        </section>
      </main>
    </div>
  );
}
