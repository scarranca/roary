"use client";

import { ArrowRightIcon, EraserIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type Autonomy, type Jobs, type Personality, speciesEmoji } from "@/lib/roary-character";
import type { Gear } from "./roary-figure";
import { Field, OptionGrid } from "./stations";

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

/** Names the voice: the closest preset when the sliders sit near one, otherwise three words from the sliders. */
export function voiceLabel(p: Personality) {
  const keys = ["playful", "detailed", "proactive", "emoji"] as const;
  const distance = (q: Personality) => Math.sqrt(keys.reduce((sum, k) => sum + (p[k] - q[k]) ** 2, 0));
  const closest = PRESETS.map((preset) => ({ preset, d: distance(preset.value) })).sort((a, b) => a.d - b.d)[0];
  if (closest && closest.d < 30) return closest.preset.label;
  const tone = p.playful > 66 ? "Playful" : p.playful < 34 ? "Professional" : "Friendly";
  const length = p.detailed > 66 ? "detailed" : p.detailed < 34 ? "concise" : "to the point";
  const initiative = p.proactive > 66 ? "proactive" : p.proactive < 34 ? "quiet" : "steady";
  return `${tone}, ${length}, ${initiative}`;
}

/** 0 is a still, quiet figure; 1 bounces. */
export function energyFrom(p: Personality) {
  return (p.playful * 0.7 + p.proactive * 0.3) / 100;
}

/**
 * A templated incident message in this Roary's voice. It describes the demo
 * shop's real bug (bundle discount, 8d41418) so the preview matches the live run.
 */
export function sampleMessage(p: Personality, name: string, autonomy: Autonomy, species: string) {
  const emoji = (e: string) => (p.emoji > 50 ? ` ${e}` : "");
  const opener = p.playful > 66 ? `Heads up, team!${emoji("👀")}` : p.playful > 33 ? "Heads up:" : "For awareness:";
  const core = "checkout fails for anyone with a single item in their cart since the bundle-discount deploy.";
  const detail =
    p.detailed > 60
      ? " What I saw: TypeError: Cannot read properties of undefined (reading 'lineTotal') in priceCart(). What I think: 8d41418 reads lines[1] without checking it exists. Confidence: high."
      : p.detailed > 30
        ? " It looks like the bundle discount in 8d41418."
        : "";
  const action =
    autonomy === "open_prs" && p.proactive > 50
      ? ` I opened a PR with a guard and a test. A human still merges.${emoji("🔧")}`
      : p.proactive > 50
        ? ` Want me to open a fix PR?${emoji("🔧")}`
        : " Let me know if you want me to dig in.";
  const signoff = p.playful > 80 ? ` ${name} is on it!${emoji(speciesEmoji(species))}` : "";
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
  name,
  summary,
  signed,
  onSign,
  logo,
  logoPatch,
}: {
  readonly name: string;
  /** The team's logo (PNG data URL) and its patch color, shown on the letterhead. */
  readonly logo?: string;
  readonly logoPatch?: string;
  readonly summary: { label: string; value: string }[];
  readonly signed: boolean;
  readonly onSign: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const typedId = useId();
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState("");

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

  const clearInk = () => {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    setHasInk(false);
  };

  // Typing a name signs too, so the offer works without a pointer.
  const typeSignature = (value: string) => {
    setTyped(value);
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.font = "italic 600 34px 'Brush Script MT', 'Segoe Script', cursive";
    ctx.fillStyle = "#0a0a0a";
    ctx.fillText(value, 16, el.clientHeight / 2 + 12);
    setHasInk(value.trim().length > 0);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="plate relative flex flex-col gap-4 bg-card p-5">
        <div className="flex items-center justify-between gap-3 border-ink border-b-2 pb-3 font-mono text-xs uppercase">
          <span className="flex items-center gap-3">
            {logo ? (
              <span className="plate grid size-12 shrink-0 place-items-center p-1" style={{ background: logoPatch ?? "#ffffff" }}>
                {/* biome-ignore lint/performance/noImgElement: local data URL */}
                <img alt="Your team's logo" className="max-h-full max-w-full object-contain" src={logo} />
              </span>
            ) : null}
            Offer of employment · Roary-01
          </span>
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
        {signed ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-4 bottom-4 rotate-[-8deg] border-[3px] border-safety bg-card/80 px-3 py-1 font-mono text-safety text-sm uppercase outline-2 outline-safety outline-offset-2"
          >
            Signed · hired
          </span>
        ) : null}
      </div>

      {signed ? (
        <Link
          className="plate inline-flex items-center justify-center gap-3 bg-safety px-6 py-4 font-mono text-ink text-lg uppercase transition-transform hover:-translate-y-0.5"
          href="/desk"
        >
          Meet {name} at the desk
          <ArrowRightIcon className="size-5" />
        </Link>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-muted-foreground text-xs uppercase">Sign here · your team</span>
              <button
                className="inline-flex items-center gap-1 font-mono text-xs uppercase underline disabled:opacity-40"
                disabled={!hasInk}
                onClick={() => {
                  clearInk();
                  setTyped("");
                }}
                type="button"
              >
                <EraserIcon className="size-3.5" />
                Clear
              </button>
            </div>
            <canvas
              aria-hidden
              className="h-32 w-full cursor-crosshair touch-none rounded-[3px] border-2 border-ink bg-card"
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
            <label className="mt-1 font-mono text-muted-foreground text-xs uppercase" htmlFor={typedId}>
              Or type your name to sign
            </label>
            <input
              autoComplete="name"
              className="rounded-[3px] border-2 border-ink bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:outline-2 focus-visible:outline-safety"
              id={typedId}
              onChange={(event) => typeSignature(event.target.value)}
              value={typed}
            />
          </div>

          <button
            className="plate inline-flex items-center justify-center gap-3 bg-safety px-6 py-4 font-mono text-ink text-lg uppercase transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-label disabled:text-muted-foreground"
            disabled={!hasInk}
            onClick={onSign}
            type="button"
          >
            {hasInk ? "Sign the offer letter" : "Sign above to hire"}
          </button>
        </>
      )}
    </div>
  );
}
