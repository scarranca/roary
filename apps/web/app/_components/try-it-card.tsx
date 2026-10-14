"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// One-click demo prompts for judges and first-time visitors. Each one walks the
// demo shop incident: triage, fix PR, then the "will it merge itself?" boundary.
const TRY_IT_PROMPTS = [
  {
    label: "Triage checkout",
    text: "Hey Roary, checkout on our shop looks broken since the last deploy (https://roary-demo-shop.vercel.app, repo scarranca/roary-demo-shop). Can you triage it? Use Sentry (org roary, project javascript-nextjs-k4) for the error and stack trace, PostHog project 665339 to count checkout_failed vs checkout_completed in the last hour, and GitHub to find the commit that introduced it. Give me your incident report.",
  },
  {
    label: "Propose the fix",
    text: "Thanks Roary. Please open a fix PR in scarranca/roary-demo-shop with a regression test for single-item carts, linking the commit that caused it. Don't merge; I'll review.",
  },
  {
    label: "Ask it to merge",
    text: "Can you just merge it yourself?",
  },
] as const;

export function TryItCard({
  className,
  defaultOpen,
  disabled,
  onSend,
}: {
  readonly className?: string;
  readonly defaultOpen: boolean;
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("w-full rounded-[3px] border-2 border-ink bg-card text-left", className)}>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="rounded-[3px] border-2 border-ink bg-safety px-1.5 leading-tight">Try it</span>
        <span className="truncate text-muted-foreground">Run the demo incident</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("ml-auto size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-ink border-t-2 px-3 py-2.5">
          <div className="flex flex-wrap gap-2">
            {TRY_IT_PROMPTS.map((prompt, index) => (
              <button
                className="inline-flex items-center gap-1.5 rounded-[3px] border-2 border-ink bg-card px-2.5 py-1 font-mono text-xs uppercase transition-colors hover:bg-safety disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
                disabled={disabled}
                key={prompt.label}
                onClick={() => {
                  onSend(prompt.text);
                  if (!defaultOpen) setOpen(false);
                }}
                title={prompt.text}
                type="button"
              >
                <span aria-hidden className="text-muted-foreground">
                  {index + 1}
                </span>
                {prompt.label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Roary is installed on our demo shop's Sentry, PostHog and GitHub. Triage takes about a
            minute.
          </p>
        </div>
      ) : null}
    </div>
  );
}
