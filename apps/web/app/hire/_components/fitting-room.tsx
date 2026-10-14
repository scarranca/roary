"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { persistHiredRoary, saveHiredRoary } from "@/lib/hired-roary-store";
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
import { FitStation, PickStation, type PictureStudy } from "./stations";

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
  const [study, setStudy] = useState<PictureStudy & { at: number }>();
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
    const hired = { name: displayName, look, personality, jobs, autonomy, snapshot, hiredAt: new Date().toISOString() };
    saveHiredRoary(hired);
    void persistHiredRoary(hired);
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
            molding={study?.status === "working"}
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

        {study && station === 0 ? <PictureStudyOverlay key={study.at} study={study} /> : null}

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
              onStudy={(next) => {
                setStudy({ ...next, at: Date.now() });
                showStage();
              }}
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

/** The picture Claude is reading, hung on the stage by a zip tag, then the parts it chose. */
function PictureStudyOverlay({ study }: { readonly study: PictureStudy }) {
  const { status, preview, character } = study;
  if (status === "done" && character) {
    const spec = [
      ["Species", character.species],
      ["Head", character.head.shape],
      ["Ears", character.ears.kind],
      ["Mane", character.mane.kind],
      ["Muzzle", character.muzzle.kind],
      ["Eyes", character.eyes.kind],
      ["Tail", character.tail.kind],
      ["Fur", character.head.color],
    ];
    return (
      <div
        aria-live="polite"
        className="readout-out plate pointer-events-none absolute top-4 right-4 flex w-56 flex-col gap-1 bg-cotton px-5 py-4 font-mono text-ink text-xs uppercase shadow-[0_14px_28px_-14px_rgb(0_0_0/0.8)]"
      >
        <span className="mb-1 text-[10px] text-muted-foreground">Spec · read from your picture</span>
        {spec.map(([label, value], i) => (
          <span
            className="type-line flex items-center gap-2"
            key={label}
            style={{ "--line-delay": `${i * 120}ms` } as CSSProperties}
          >
            <span className="w-16 text-muted-foreground">{label}:</span>
            {label === "Fur" ? (
              <span aria-hidden className="size-3 rounded-[2px] border-[1.5px] border-ink" style={{ background: value }} />
            ) : null}
            {value}
          </span>
        ))}
        <span
          className="type-line mt-2 self-start bg-safety py-1 pr-2 pl-3 [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_50%)]"
          style={{ "--line-delay": `${spec.length * 120}ms` } as CSSProperties}
        >
          New character · 1 of 1
        </span>
      </div>
    );
  }
  const failed = status === "error";
  return (
    <div className={cn("pointer-events-none absolute top-0 right-6", failed && "readout-out")}>
      <div
        className="swing flex flex-col items-center"
        style={{ "--swing-rest": "-4deg", "--hang-y": "0px" } as CSSProperties}
      >
        <span aria-hidden className="h-8 w-1.5 bg-safety" />
        <span aria-hidden className="-mt-1 h-5 w-9 bg-safety [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" />
        <figure className="-mt-2 flex flex-col gap-2 rounded-[2px] border-2 border-ink bg-cotton p-2 pb-3 shadow-[0_14px_28px_-14px_rgb(0_0_0/0.8)]">
          <div className="relative size-32 overflow-hidden border-2 border-ink sm:size-40">
            {/* biome-ignore lint/performance/noImgElement: local data URL preview */}
            <img alt="Your upload" className={cn("size-full object-cover", failed && "grayscale")} src={preview} />
            {failed ? (
              <span className="hazard absolute inset-x-0 top-1/2 grid -translate-y-1/2 place-items-center py-2">
                <span className="border-2 border-ink bg-cotton px-2 py-0.5 font-mono text-ink text-xs uppercase">
                  Couldn't read it
                </span>
              </span>
            ) : (
              <span aria-hidden className="scanline" />
            )}
          </div>
          <figcaption aria-live="polite" className="max-w-32 font-mono text-[10px] text-ink uppercase leading-tight sm:max-w-40">
            {failed ? "Try a clearer picture" : "Claude is studying your picture…"}
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
