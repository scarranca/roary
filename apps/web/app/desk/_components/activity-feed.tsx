"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type IncidentStatus = "investigating" | "diagnosed" | "fix_proposed" | "resolved";
type Status = IncidentStatus | "shipped";

type Incident = {
  id: number;
  sentryIssueId: string;
  title: string;
  status: IncidentStatus;
  usersAffected: number | null;
  suspectCommit: string | null;
  prUrl: string | null;
  updatedAt: string;
};

type Launch = {
  id: number;
  repo: string;
  prNumber: number;
  title: string;
  videoUrl: string | null;
  healthSummary: string | null;
  createdAt: string;
};

type FeedWorkspace = { signedIn: boolean; isDemo: boolean; connected: string[] };

type Feed = { incidents: Incident[]; launches: Launch[]; workspace?: FeedWorkspace };

type Row = {
  key: string;
  kind: "Incident" | "Launch";
  ref: string;
  title: string;
  details: string[];
  link?: { href: string; label: string };
  status: Status;
  at: string;
};

const POLL_MS = 3000;
const FLASH_MS = 1200;

const STATUS_STYLES: Record<Status, { label: string; className: string }> = {
  investigating: { label: "Investigating", className: "bg-label" },
  diagnosed: { label: "Diagnosed", className: "bg-wait-soft" },
  fix_proposed: { label: "Fix proposed", className: "bg-safety" },
  resolved: { label: "Resolved", className: "bg-ok-soft" },
  shipped: { label: "Shipped", className: "bg-ok-soft" },
};

function toRows(feed: Feed): Row[] {
  const incidents: Row[] = feed.incidents.map((incident) => ({
    key: `incident-${incident.id}`,
    kind: "Incident",
    ref: incident.sentryIssueId,
    title: incident.title,
    details: [
      incident.usersAffected != null ? `${incident.usersAffected} users affected` : null,
      incident.suspectCommit ? `suspect ${incident.suspectCommit.slice(0, 7)}` : null,
    ].filter((detail): detail is string => detail !== null),
    link: incident.prUrl ? { href: incident.prUrl, label: "Fix PR" } : undefined,
    status: incident.status,
    at: incident.updatedAt,
  }));
  const launches: Row[] = feed.launches.map((launch) => ({
    key: `launch-${launch.id}`,
    kind: "Launch",
    // Direct pushes are stored with pr_number 0 (the short sha leads the title).
    ref: launch.prNumber ? `${launch.repo}#${launch.prNumber}` : launch.repo,
    title: launch.title,
    details: launch.healthSummary ? [launch.healthSummary] : [],
    link: launch.videoUrl ? { href: launch.videoUrl, label: "Launch video" } : undefined,
    status: "shipped",
    at: launch.createdAt,
  }));
  return [...incidents, ...launches].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function timeAgo(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function useFeed() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [workspace, setWorkspace] = useState<FeedWorkspace>();
  const [failed, setFailed] = useState(false);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Map<string, Status> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function poll() {
      try {
        // Same-origin cookies: a signed-in person sees their own workspace's feed. A stale
        // `__vdpl` skew cookie is expired by next.config.ts headers on any response.
        const response = await fetch("/api/feed", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(`feed ${response.status}`);
        const feed = (await response.json()) as Feed;
        const next = toRows(feed);
        if (cancelled) return;
        setWorkspace(feed.workspace);

        // Flash rows that are new or changed status since the last poll (not on first load).
        const previous = seen.current;
        if (previous) {
          const changed = new Set(next.filter((row) => previous.get(row.key) !== row.status).map((row) => row.key));
          if (changed.size > 0) {
            setFlashing(changed);
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => setFlashing(new Set()), FLASH_MS);
          }
        }
        seen.current = new Map(next.map((row) => [row.key, row.status]));
        setRows(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) {
        setNow(Date.now());
        schedule();
      }
    }

    function schedule() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") timer = setTimeout(poll, POLL_MS);
    }

    function onVisibility() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(flashTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { rows, workspace, failed, flashing, now };
}

export function ActivityFeed() {
  const { rows, workspace, failed, flashing, now } = useFeed();
  const needsStack = workspace?.signedIn === true && workspace.connected.length === 0;

  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      {rows === null && !failed ? (
        <p className="font-mono text-muted-foreground text-xs uppercase">Opening the log…</p>
      ) : null}

      {needsStack && rows !== null && rows.length === 0 ? (
        <div className="hazard-soft flex flex-col gap-3 rounded-[3px] border-2 border-ink p-6">
          <p className="w-fit rounded-[3px] border-2 border-ink bg-label px-2 py-0.5 font-mono text-xs uppercase">
            Nothing connected
          </p>
          <h3 className="type-display text-3xl">Connect your stack</h3>
          <p className="font-mono text-sm uppercase">
            This is your own workspace. Connect Sentry and PostHog so Roary can watch your errors and count who&apos;s
            affected. Until then it won&apos;t touch the demo shop&apos;s data for you.
          </p>
          <a
            className="plate inline-flex w-fit items-center gap-2 bg-safety px-6 py-2.5 font-mono text-ink text-xs uppercase"
            href="/settings/connections"
          >
            Connect your stack →
          </a>
        </div>
      ) : null}

      {!needsStack && rows !== null && rows.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-[3px] border-2 border-ink border-dashed p-6">
          <p className="w-fit rounded-[3px] border-2 border-ink bg-label px-2 py-0.5 font-mono text-xs uppercase">
            Log empty
          </p>
          <h3 className="type-display text-3xl">Roary hasn't logged anything yet.</h3>
          <p className="font-mono text-sm uppercase">Ask it in the chat what broke. Its work shows up here live.</p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ul className="flex flex-col border-ink border-t-2">
          {rows.map((row) => {
            const status = STATUS_STYLES[row.status];
            return (
              <li
                className={cn(
                  "grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 border-ink border-b-2 px-2 py-4",
                  flashing.has(row.key) && "feed-flash",
                )}
                key={row.key}
              >
                <p className="font-mono text-muted-foreground text-xs uppercase">
                  {row.kind} · {row.ref} · {timeAgo(row.at, now)}
                </p>
                <span
                  className={cn(
                    "quoted row-span-3 self-center whitespace-nowrap rounded-[3px] border-2 border-ink px-2.5 py-1 font-mono text-ink text-xs uppercase",
                    status.className,
                  )}
                >
                  {status.label}
                </span>
                <h3 className="type-display text-3xl">{row.title}</h3>
                {row.details.length > 0 || row.link ? (
                  <p className="font-mono text-sm uppercase">
                    {row.details.join(" · ")}
                    {row.details.length > 0 && row.link ? " · " : null}
                    {row.link ? (
                      <a className="underline underline-offset-2" href={row.link.href} rel="noreferrer" target="_blank">
                        {row.link.label}
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {failed ? (
        <p className="w-fit border-2 border-ink bg-wait-soft px-2 py-1 font-mono text-xs uppercase">
          Can't reach the log right now · retrying{rows ? " · showing the last update" : ""}
        </p>
      ) : null}
    </div>
  );
}
