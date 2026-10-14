"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ZipTag } from "./zip-tag";

const JOBS = [
  {
    id: "JD-01",
    title: "Triage errors",
    tools: "Sentry + PostHog",
    output: "Root cause, people affected, suspect commit",
  },
  {
    id: "JD-02",
    title: "Open fix PRs",
    tools: "GitHub + sandbox",
    output: "A PR with the fix and a test",
  },
  {
    id: "JD-03",
    title: "Review launches",
    tools: "Vercel + PostHog",
    output: "Daily launch health report",
  },
  {
    id: "JD-04",
    title: "Make launch videos",
    tools: "HyperFrames + Blob",
    output: "An MP4 posted on the merged PR",
  },
] as const;

export function JobSheet() {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(JOBS.map((job) => [job.id, true])),
  );
  const count = JOBS.filter((job) => on[job.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col border-ink border-t-2">
        {JOBS.map((job) => {
          const active = on[job.id];
          return (
            <li
              className={cn(
                "grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-ink border-b-2 px-3 py-5 sm:grid-cols-[7rem_1.3fr_1fr_1.4fr_auto] sm:px-4",
                !active && "hazard-soft text-muted-foreground",
              )}
              key={job.id}
            >
              <span className="hidden font-mono text-sm sm:block">{job.id}</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h3 className="quoted type-display text-4xl sm:text-5xl">{job.title}</h3>
                {active ? (
                  <ZipTag className="pointer-events-none" key={`${job.id}-on`} rest={-4}>
                    On the job
                  </ZipTag>
                ) : null}
              </div>
              <JobToggle
                active={active}
                label={job.title}
                onToggle={() => setOn((prev) => ({ ...prev, [job.id]: !prev[job.id] }))}
              />
              <p className="col-span-2 font-mono text-sm uppercase sm:col-span-1 sm:col-start-3 sm:row-start-1">
                <span className="text-muted-foreground">Tools: </span>
                {job.tools}
              </p>
              <p className="col-span-2 font-mono text-sm uppercase sm:col-span-1 sm:col-start-4 sm:row-start-1">
                <span className="text-muted-foreground">Output: </span>
                {job.output}
              </p>
            </li>
          );
        })}
        <li className="hazard-soft grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-ink border-b-2 px-3 py-5 sm:grid-cols-[7rem_1.3fr_1fr_1.4fr_auto] sm:px-4">
          <span className="hidden w-fit bg-cotton px-1 font-mono text-sm sm:block">JD-XX</span>
          <h3 className="quoted w-fit bg-cotton px-1 type-display text-4xl text-muted-foreground line-through decoration-4 sm:text-5xl">
            Merge PRs
          </h3>
          <span className="hazard grid h-11 w-24 place-items-center rounded-[3px] border-2 border-ink">
            <span className="bg-cotton px-1.5 font-mono text-ink text-xs">LOCKED</span>
          </span>
          <p className="col-span-2 w-fit bg-cotton px-1.5 py-1 font-mono text-sm uppercase sm:col-span-2 sm:col-start-3 sm:row-start-1">
            Never. Roary proposes, a human merges. Not a setting you can turn on.
          </p>
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-sm uppercase" aria-live="polite">
          {count} of {JOBS.length} jobs on · you can change these later
        </p>
        <Link
          className="plate inline-flex items-center gap-2 bg-ink px-5 py-3 font-mono text-cotton uppercase [--screw:var(--cotton)] hover:bg-nylon"
          href="/hire"
        >
          Hire Roary for these jobs
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function JobToggle({
  active,
  label,
  onToggle,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-label={`${label}: ${active ? "on" : "off"}`}
      aria-pressed={active}
      className={cn(
        "grid h-11 w-24 place-items-center rounded-[3px] border-2 border-ink font-mono text-sm uppercase transition-colors",
        active ? "plate bg-safety text-ink" : "hazard text-ink",
      )}
      onClick={onToggle}
      type="button"
    >
      <span className={cn("quoted", !active && "bg-cotton px-1.5")}>{active ? "On" : "Off"}</span>
    </button>
  );
}
