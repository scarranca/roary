"use client";

import { EraserIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Gear } from "./roary-figure";
import { Field, OptionGrid } from "./stations";

export type Personality = { playful: number; detailed: number; proactive: number; emoji: number };
export type Jobs = { triage: boolean; fixPrs: boolean; launchReview: boolean; launchVideo: boolean };
export type Autonomy = "suggest" | "open_prs";

export const DEFAULT_PERSONALITY: Personality = { playful: 55, detailed: 50, proactive: 55, emoji: 35 };
export const DEFAULT_JOBS: Jobs = { triage: true, fixPrs: true, launchReview: true, launchVideo: true };

const PRESETS: { label: string; value: Personality }[] = [
  { label: "Calm senior", value: { playful: 15, detailed: 70, proactive: 35, emoji: 0 } },
  { label: "Hype buddy", value: { playful: 95, detailed: 25, proactive: 85, emoji: 90 } },
  { label: "Mentor", value: { playful: 45, detailed: 95, proactive: 50, emoji: 15 } },
];

export const JOB_LIST: { key: keyof Jobs; label: string; gear: Gear }[] = [
  { key: "triage", label: "Triage errors", gear: "net" },
  { key: "fixPrs", label: "Open fix PRs", gear: "wrench" },
  { key: "launchReview", label: "Review launches", gear: "clipboard" },
  { key: "launchVideo", label: "Make launch videos", gear: "clapper" },
];

/** 0 is a still, quiet figure; 1 bounces. */
export function energyFrom(p: Personality) {
  return (p.playful * 0.7 + p.proactive * 0.3) / 100;
}

/** A templated incident message in this Roary's voice, until the live agent writes it (#16). */
export function sampleMessage(p: Personality, name: string, autonomy: Autonomy) {
  const emoji = (e: string) => (p.emoji > 50 ? ` ${e}` : "");
  const opener = p.playful > 66 ? `Heads up, team!${emoji("👀")}` : p.playful > 33 ? "Heads up:" : "For awareness:";
  const core = "checkout errors jumped after the 2:10 deploy. 38 people hit it in the last hour.";
  const detail =
    p.detailed > 60
      ? " What I saw: TypeError: coupon is undefined in applyDiscount(). What I think: the coupon change in a41c9e2 skips the empty-cart case."
      : p.detailed > 30
        ? " It looks like the coupon change in a41c9e2."
        : "";
  const action =
    autonomy === "open_prs" && p.proactive > 50
      ? ` I already opened PR #41 with a fix and a test. A human still merges.${emoji("🔧")}`
      : p.proactive > 50
        ? ` Want me to open a fix PR?${emoji("🔧")}`
        : " Let me know if you want me to dig in.";
  const signoff = p.playful > 80 ? ` ${name} is on it!${emoji("🦁")}` : "";
  return `${opener} ${core}${detail}${action}${signoff}`;
}

function Slider({
  label,
  left,
  right,
  value,
  onChange,
}: {
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex justify-between font-mono text-xs uppercase" htmlFor={id}>
        <span>{left}</span>
        <span className="sr-only">{label}</span>
        <span>{right}</span>
      </label>
      <input
        className="h-3 w-full cursor-pointer appearance-none rounded-[2px] border-2 border-ink bg-label accent-safety [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[3px] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-safety"
        id={id}
        max={100}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        type="range"
        value={value}
      />
    </div>
  );
}

export function PersonalityStation({
  personality,
  onChange,
}: {
  readonly personality: Personality;
  readonly onChange: (personality: Personality) => void;
}) {
  const set = (key: keyof Personality) => (value: number) => onChange({ ...personality, [key]: value });
  return (
    <div className="flex flex-col gap-7">
      <Field label="Presets">
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => (
            <button
              className="rounded-[3px] border-2 border-ink bg-card px-2 py-2.5 font-mono text-xs uppercase hover:bg-label"
              key={preset.label}
              onClick={() => onChange(preset.value)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Voice">
        <div className="flex flex-col gap-5">
          <Slider label="Tone" left="Professional" onChange={set("playful")} right="Playful" value={personality.playful} />
          <Slider label="Length" left="Concise" onChange={set("detailed")} right="Detailed" value={personality.detailed} />
          <Slider label="Initiative" left="Quiet" onChange={set("proactive")} right="Proactive" value={personality.proactive} />
          <Slider label="Emoji" left="No emoji" onChange={set("emoji")} right="Lots" value={personality.emoji} />
        </div>
      </Field>
      <p className="font-mono text-muted-foreground text-xs uppercase">
        Watch the stage: the message and how Roary moves follow the sliders.
      </p>
    </div>
  );
}

export function JobsStation({
  jobs,
  autonomy,
  onJobs,
  onAutonomy,
}: {
  readonly jobs: Jobs;
  readonly autonomy: Autonomy;
  readonly onJobs: (jobs: Jobs, turnedOn?: Gear) => void;
  readonly onAutonomy: (autonomy: Autonomy) => void;
}) {
  return (
    <div className="flex flex-col gap-7">
      <Field label="Jobs">
        <ul className="flex flex-col border-ink border-t-2">
          {JOB_LIST.map((job) => {
            const on = jobs[job.key];
            return (
              <li
                className={cn(
                  "flex items-center justify-between gap-3 border-ink border-b-2 px-2 py-3",
                  !on && "hazard-soft text-muted-foreground",
                )}
                key={job.key}
              >
                <span className="quoted type-display text-2xl">{job.label}</span>
                <button
                  aria-pressed={on}
                  className={cn(
                    "grid h-10 w-20 place-items-center rounded-[3px] border-2 border-ink font-mono text-ink text-xs uppercase",
                    on ? "plate bg-safety" : "hazard",
                  )}
                  onClick={() => onJobs({ ...jobs, [job.key]: !on }, on ? undefined : job.gear)}
                  type="button"
                >
                  <span className={cn("quoted", !on && "bg-cotton px-1")}>{on ? "On" : "Off"}</span>
                </button>
              </li>
            );
          })}
          <li className="hazard-soft flex items-center justify-between gap-3 border-ink border-b-2 px-2 py-3">
            <span className="quoted bg-cotton px-1 type-display text-2xl text-muted-foreground line-through">Merge PRs</span>
            <span className="grid h-10 w-20 place-items-center rounded-[3px] border-2 border-ink bg-cotton font-mono text-xs uppercase">
              Locked
            </span>
          </li>
        </ul>
      </Field>
      <Field label="When Roary finds a fix">
        <OptionGrid<Autonomy>
          columns={2}
          onChange={onAutonomy}
          options={[
            { value: "suggest", label: "Suggest only" },
            { value: "open_prs", label: "Open the PR" },
          ]}
          value={autonomy}
        />
      </Field>
    </div>
  );
}

export function OfferStation({
  summary,
  signed,
  onSign,
}: {
  readonly summary: { label: string; value: string }[];
  readonly signed: boolean;
  readonly onSign: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.clientWidth * ratio;
    el.height = el.clientHeight * ratio;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0a0a0a";
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };

  const clear = () => {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    setHasInk(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="plate flex flex-col gap-4 bg-card p-5">
        <div className="flex items-center justify-between gap-3 border-ink border-b-2 pb-3 font-mono text-xs uppercase">
          <span>Offer of employment · Roary-01</span>
          <span aria-hidden className="barcode block h-4 w-20" />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 font-mono text-sm uppercase">
          {summary.map(({ label, value }) => (
            <div className="contents" key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-muted-foreground text-xs uppercase">Sign here · your team</span>
          <button
            className="inline-flex items-center gap-1 font-mono text-xs uppercase underline disabled:opacity-40"
            disabled={!hasInk || signed}
            onClick={clear}
            type="button"
          >
            <EraserIcon className="size-3.5" />
            Clear
          </button>
        </div>
        <canvas
          aria-label="Signature pad. Draw your signature with a finger or mouse."
          className={cn(
            "h-32 w-full touch-none rounded-[3px] border-2 border-ink bg-card",
            signed ? "pointer-events-none" : "cursor-crosshair",
          )}
          onPointerDown={(event) => {
            const ctx = canvas.current?.getContext("2d");
            if (!ctx) return;
            drawing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            const [x, y] = point(event);
            ctx.beginPath();
            ctx.moveTo(x, y);
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const ctx = canvas.current?.getContext("2d");
            if (!ctx) return;
            const [x, y] = point(event);
            ctx.lineTo(x, y);
            ctx.stroke();
            setHasInk(true);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          ref={canvas}
        />
      </div>

      <button
        className="plate inline-flex items-center justify-center gap-3 bg-safety px-6 py-4 font-mono text-ink text-lg uppercase transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
        disabled={!hasInk || signed}
        onClick={onSign}
        type="button"
      >
        {signed ? "Signed · welcome to the team" : "Sign the offer letter"}
      </button>
    </div>
  );
}
