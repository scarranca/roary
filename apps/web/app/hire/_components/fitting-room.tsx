"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { saveHiredRoary } from "@/lib/hired-roary-store";
import {
  type Autonomy,
  DEFAULT_JOBS,
  DEFAULT_LOOK,
  DEFAULT_PERSONALITY,
  type Jobs,
  type Personality,
  PRESETS,
  type RoaryLook,
} from "@/lib/roary-character";
import { cn } from "@/lib/utils";
import { energyFrom, JOB_LIST, JobsStation, OfferStation, PersonalityStation, sampleMessage } from "./hire-stations";
import type { FigureCue, Gear } from "./roary-figure";
import { FitStation, PickStation } from "./stations";

// WebGL only runs in the browser; the stage shows a still until it loads.
const RoaryStage = dynamic(() => import("./roary-stage"), {
  ssr: false,
  loading: () => (
    <span aria-hidden className="grid h-full place-items-center text-[9rem] leading-none">
      🦁
    </span>
  ),
});

const STATIONS = [
  { short: "Pick", title: "Pick your Roary" },
  { short: "Fit & swag", title: "Fit & swag" },
  { short: "Personality", title: "Personality" },
  { short: "Jobs", title: "Job description" },
  { short: "Offer", title: "Offer letter" },
] as const;

const OUTFIT_LABEL = { crew: "Crew jacket", hoodie: "Hoodie", tee: "Tee" } as const;

export function FittingRoom() {
  const [station, setStation] = useState(0);
  const [look, setLook] = useState<RoaryLook>(DEFAULT_LOOK);
  const [presetId, setPresetId] = useState("roary");
  const [name, setName] = useState("Roary");
  const [personality, setPersonality] = useState<Personality>(DEFAULT_PERSONALITY);
  const [jobs, setJobs] = useState<Jobs>(DEFAULT_JOBS);
  const [autonomy, setAutonomy] = useState<Autonomy>("suggest");
  const [gear, setGear] = useState<Gear | undefined>();
  const [cue, setCue] = useState<FigureCue>();
  const [signedAt, setSignedAt] = useState<number>();
  const [spin, setSpin] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const snapshotRef = useRef<(() => string | undefined) | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // On phones the stage sits above the controls; bring it back into view so reactions aren't missed.
  const showStage = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    stageRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  };
  const current = STATIONS[station];
  const isLast = station === STATIONS.length - 1;
  const displayName = name.trim() || "Roary";

  const pickPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setLook((prev) => ({ ...prev, character: preset.character }));
    if (name === "Roary" || PRESETS.some((p) => p.label === name)) setName(preset.label);
  };

  const sign = () => {
    // Snapshot first, before the roar distorts the pose.
    const snapshot = snapshotRef.current?.();
    saveHiredRoary({ name: displayName, look, personality, jobs, autonomy, snapshot, hiredAt: new Date().toISOString() });
    setSignedAt(Date.now());
    setCue({ kind: "roar", at: Date.now() });
    showStage();
  };

  const goTo = (index: number) => {
    setStation(index);
    // Each station has its own pose: gear shows up at Jobs, a pop greets every arrival.
    if (index === 3) setGear((g) => g ?? JOB_LIST.find((job) => jobs[job.key])?.gear);
    setCue({ kind: "pop", at: Date.now() });
    showStage();
  };

  const jobsOn = JOB_LIST.filter((job) => jobs[job.key]).map((job) => job.label);
  const summary = [
    { label: "Name", value: displayName },
    { label: "Character", value: look.character.species },
    { label: "Wears", value: `${OUTFIT_LABEL[look.outfit]}${look.logo ? " + your logo" : ""}` },
    { label: "Jobs", value: jobsOn.length ? jobsOn.join(", ") : "None yet" },
    { label: "Fixes", value: autonomy === "open_prs" ? "Opens PRs" : "Suggests only" },
    { label: "Merges", value: "Never · humans merge" },
  ];

  return (
    <main className="grid flex-1 lg:min-h-0 lg:grid-cols-[1.4fr_1fr]">
      <section
        aria-label={`${displayName}, your ${look.character.species}. Use left and right arrows to spin, space to poke.`}
        className="ripstop relative min-h-[48dvh] scroll-mt-0 overflow-hidden text-cotton outline-none focus-visible:outline-2 focus-visible:outline-safety focus-visible:-outline-offset-4 lg:min-h-0"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setSpin((s) => s - Math.PI / 4);
          else if (event.key === "ArrowRight") setSpin((s) => s + Math.PI / 4);
          else if (event.key === " ") setCue({ kind: "poke", at: Date.now() });
          else return;
          event.preventDefault();
        }}
        ref={stageRef}
        tabIndex={0}
      >
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_50%_42%_at_50%_45%,rgb(255_255_255/0.16),transparent_70%)]"
        />
        <div className="absolute inset-0">
          <RoaryStage
            cue={cue}
            energy={energyFrom(personality)}
            gear={station >= 3 ? gear : undefined}
            look={look}
            reducedMotion={reducedMotion}
            snapshotRef={snapshotRef}
            spin={spin}
          />
        </div>

        <div className={cn("pointer-events-none absolute top-4 left-4 flex flex-col gap-1", signedAt && "hidden")}>
          <span className="type-display text-5xl">{`"${displayName}"`}</span>
          <span className="font-mono text-xs uppercase opacity-85">{look.character.species} · edition 1 of 1</span>
        </div>

        {station >= 2 && !signedAt ? (
          <p
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 bottom-10 rounded-[3px] border-2 border-ink bg-cotton p-2.5 text-ink text-xs leading-snug shadow-[0_10px_24px_-12px_rgb(0_0_0/0.7)] sm:text-sm lg:inset-x-auto lg:top-24 lg:right-4 lg:bottom-auto lg:max-w-[22rem] lg:p-3"
          >
            {sampleMessage(personality, displayName, autonomy, look.character.species)}
            <span className="mt-1.5 block font-mono text-[10px] text-muted-foreground uppercase">Example message</span>
          </p>
        ) : null}

        {signedAt ? <SigningMoment key={signedAt} name={displayName} species={look.character.species} /> : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap justify-between gap-2 font-mono text-xs uppercase opacity-85",
            signedAt && "hidden",
          )}
        >
          <span>Drag or arrow keys to spin · tap to poke</span>
          <span>Roary-01</span>
        </div>
      </section>

      <section
        aria-labelledby="station-title"
        className="flex min-h-0 flex-col border-ink border-t-2 bg-background lg:border-t-0 lg:border-l-2"
      >
        <nav aria-label="Stations" className="flex overflow-x-auto border-ink border-b-2">
          {STATIONS.map(({ short }, index) => (
            <button
              aria-current={index === station ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-ink border-r-2 px-3 py-3 font-mono text-xs uppercase last:border-r-0",
                index === station ? "bg-ink text-cotton" : index < station ? "bg-label" : "hover:bg-label",
              )}
              key={short}
              onClick={() => goTo(index)}
              type="button"
            >
              <span>{index + 1}</span>
              {short}
            </button>
          ))}
        </nav>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5 sm:p-6">
          <h1 className="quoted type-display text-5xl sm:text-6xl" id="station-title">
            {current.title}
          </h1>
          {station === 0 ? (
            <PickStation
              look={look}
              name={name}
              onCharacter={(character) => {
                setPresetId("custom");
                setLook((prev) => ({ ...prev, character }));
              }}
              onName={setName}
              onPreset={pickPreset}
              presetId={presetId}
            />
          ) : null}
          {station === 1 ? <FitStation look={look} onChange={setLook} /> : null}
          {station === 2 ? <PersonalityStation onChange={setPersonality} personality={personality} /> : null}
          {station === 3 ? (
            <JobsStation
              autonomy={autonomy}
              jobs={jobs}
              onAutonomy={setAutonomy}
              onJobs={(next, turnedOn) => {
                setJobs(next);
                setGear(turnedOn ?? JOB_LIST.find((job) => next[job.key])?.gear);
              }}
            />
          ) : null}
          {station === 4 ? (
            <OfferStation name={displayName} onSign={sign} signed={signedAt !== undefined} summary={summary} />
          ) : null}
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-ink border-t-2 bg-background p-4">
          <button
            className="plate inline-flex items-center gap-2 bg-card px-4 py-2.5 font-mono text-sm uppercase disabled:opacity-40"
            disabled={station === 0}
            onClick={() => goTo(station - 1)}
            type="button"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </button>
          {isLast ? (
            signedAt ? (
              <Link
                className="plate inline-flex items-center gap-2 bg-ink px-4 py-2.5 font-mono text-cotton text-sm uppercase [--screw:var(--cotton)]"
                href="/desk"
              >
                Meet {displayName} at the desk
                <ArrowRightIcon className="size-4" />
              </Link>
            ) : (
              <span className="font-mono text-muted-foreground text-xs uppercase">Sign to finish</span>
            )
          ) : (
            <button
              className="plate inline-flex items-center gap-2 bg-safety px-4 py-2.5 font-mono text-ink text-sm uppercase"
              onClick={() => goTo(station + 1)}
              type="button"
            >
              Next: {STATIONS[station + 1].short}
              <ArrowRightIcon className="size-4" />
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

/** The roar: zip tags rain over the stage, then the figure is boxed as a one-of-one edition. */
function SigningMoment({ name, species }: { readonly name: string; readonly species: string }) {
  const tags = Array.from({ length: 22 }, (_, i) => i);
  return (
    <div aria-live="assertive" className="pointer-events-none absolute inset-0">
      <span className="sr-only">{`${name} roars. Offer signed. ${name} is boxed as edition 1 of 1.`}</span>
      {tags.map((i) => (
        <span
          aria-hidden
          className="tag-fall absolute top-0 h-5 w-10 bg-safety [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_50%)]"
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              "--fall-delay": `${(i % 7) * 0.12}s`,
              "--fall-spin": `${((i * 53) % 360) - 180}deg`,
            } as CSSProperties
          }
        />
      ))}
      <div className="box-rise absolute inset-3 flex flex-col rounded-[3px] border-[10px] border-ink">
        <div className="flex items-center justify-between gap-3 bg-safety px-4 py-2 text-ink">
          <span className="type-display text-3xl">{`"${name}"`}</span>
          <span className="font-mono text-xs uppercase">{species} · edition 1 of 1</span>
        </div>
        <div className="flex-1" />
        <div className="hazard-on-safety h-4" />
      </div>
    </div>
  );
}
