import { ArrowRightIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { JobSheet } from "./_components/job-sheet";
import { SiteHeader } from "./_components/site-header";
import { ZipTag } from "./_components/zip-tag";

// An example shift, labeled as such on the page. None of it is real customer data.
const SHIFT = [
  {
    time: "09:02",
    title: "Something broke",
    body: "Sentry flags a new TypeError on checkout right after the bundle-discount deploy.",
  },
  {
    time: "09:04",
    title: "Who got hurt",
    body: "PostHog shows every failure is a cart with a single item. Multi-item carts are fine.",
  },
  {
    time: "09:11",
    title: "Fix proposed",
    body: "Roary reproduces it in a sandbox and opens a PR with a guard and a test.",
  },
  {
    time: "17:30",
    title: "Launch day",
    body: "Dark mode merges. Roary cuts a 24-second launch video and posts it on the PR.",
  },
] as const;

const HOUSE_RULES = ["Never merges", "Never force-pushes", "Asks before anything risky"] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader />
      <main>
        <Hero />
        <section
          aria-labelledby="jobs-title"
          className="mx-auto flex w-full max-w-7xl scroll-mt-6 flex-col gap-10 px-4 py-20 sm:px-6 sm:py-28"
          id="jobs"
        >
          <div className="flex flex-col gap-4">
            <h2 className="quoted type-display text-6xl sm:text-8xl" id="jobs-title">
              Job description
            </h2>
            <p className="max-w-2xl text-lg">
              Four jobs, switched on by default. Turn off what your team already covers. One job
              stays locked off for good.
            </p>
          </div>
          <JobSheet />
        </section>
        <FirstDay />
        <HouseRules />
        <OfferLetter />
      </main>
      <footer className="border-ink border-t-2">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 font-mono text-sm uppercase sm:px-6">
          <span>Roary · AI engineer · built on Vercel eve</span>
          <span>Vercel Fast Forward · Oct 2026</span>
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pt-14 lg:pb-24">
      <div className="flex flex-col gap-7">
        <h1 className="type-display text-[clamp(3.6rem,10vw,6rem)]">
          <span className="block">{'"The'}</span>
          <span className="block">teammate</span>
          <span className="block">
            you <span className="bg-safety px-2">hire</span>{'"'}
          </span>
        </h1>
        <p className="max-w-lg text-lg leading-relaxed">
          Not the tool you configure. Roary watches Sentry, PostHog and Vercel, figures out why
          something broke, opens the fix, and makes a launch video when you ship.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            className="plate inline-flex items-center gap-3 bg-safety px-6 py-4 font-mono text-ink text-lg uppercase transition-transform hover:-translate-y-0.5"
            href="/hire"
          >
            Hire Roary
            <ArrowRightIcon className="size-5" />
          </Link>
          <Link
            className="inline-flex items-center gap-2 font-mono uppercase underline hover:text-muted-foreground"
            href="/desk"
          >
            Talk to Roary first
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>
        <dl className="plate grid w-fit grid-cols-[auto_1fr] gap-x-4 gap-y-1 bg-card px-6 py-4 font-mono text-sm uppercase">
          <dt className="text-muted-foreground">Role</dt>
          <dd>AI engineer</dd>
          <dt className="text-muted-foreground">Watches</dt>
          <dd>Sentry · PostHog · Vercel</dd>
          <dt className="text-muted-foreground">Acts on</dt>
          <dd>GitHub</dd>
        </dl>
      </div>
      <CrewJacket />
    </section>
  );
}

/** Roary's issued jacket: black nylon back panel, quoted print, ID badge, new-hire tag. */
function CrewJacket() {
  return (
    <figure className="relative">
      <div className="ripstop relative aspect-[5/6] overflow-hidden rounded-[3px] border-2 border-ink text-cotton sm:aspect-[6/5]">
        <span
          aria-hidden
          className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--cotton)_0_26px,transparent_26px_52px)] opacity-90 [clip-path:polygon(100%_34%,100%_88%,42%_88%)]"
        />
        <JacketConstruction />
        <span className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-[3px] bg-safety px-3 pt-0.5 pb-1 font-mono text-[11px] text-ink uppercase">
          Roary · size team
        </span>
        <div className="plate absolute top-[12%] left-6 bg-cotton px-4 py-2 font-mono text-[10px] text-ink uppercase leading-relaxed sm:left-10 sm:text-[11px]">
          Object: crew jacket
          <br />
          Issue: Roary-01
          <br />
          Zone: your repo
        </div>
        <p className="absolute top-[28%] left-6 type-display text-[clamp(4rem,11vw,6rem)] sm:left-10">
          {'"Roary"'}
        </p>
        <p className="absolute top-[28%] left-6 mt-[clamp(4rem,10vw,5.6rem)] type-display text-[clamp(1.8rem,4.5vw,2.6rem)] text-safety sm:left-10">
          AI engineer
        </p>
        <IdBadge />
      </div>
      <HangingTag />
      <figcaption className="sr-only">
        Roary's crew jacket with an ID badge: Roary, AI engineer, opens PRs, never merges.
      </figcaption>
    </figure>
  );
}

/** Yoke seam, side seams and a ribbed hem, stitched in two-needle lines. */
function JacketConstruction() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 600 500"
    >
      <path vectorEffect="non-scaling-stroke" d="M0 52 Q300 82 600 52" fill="none" stroke="var(--ink)" strokeWidth="3" />
      <path vectorEffect="non-scaling-stroke" d="M0 60 Q300 90 600 60" fill="none" stroke="rgb(255 255 255 / 0.35)" strokeDasharray="5 5" strokeWidth="1.2" />
      <path vectorEffect="non-scaling-stroke" d="M0 45 Q300 75 600 45" fill="none" stroke="rgb(255 255 255 / 0.35)" strokeDasharray="5 5" strokeWidth="1.2" />
      <path vectorEffect="non-scaling-stroke" d="M22 60 V440 M578 60 V440" fill="none" stroke="rgb(255 255 255 / 0.3)" strokeDasharray="5 5" strokeWidth="1.2" />
      <rect fill="var(--ink)" height="58" width="600" x="0" y="442" />
      <path vectorEffect="non-scaling-stroke" d="M0 442 H600" stroke="rgb(255 255 255 / 0.4)" strokeDasharray="5 5" strokeWidth="1.2" />
      <path
        d={Array.from({ length: 120 }, (_, i) => `M${i * 5 + 2.5} 448 V496`).join(" ")}
        stroke="rgb(255 255 255 / 0.14)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** The NEW HIRE tag, tied through a grommet on the panel's top edge. */
function HangingTag() {
  return (
    <div className="absolute top-7 right-[16%] size-0">
      <span
        aria-hidden
        className="absolute -top-2.5 -left-2.5 size-5 rounded-full border-[3px] border-label bg-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.8)]"
      />
      <svg aria-hidden className="absolute -top-1 -left-2 h-10 w-4 overflow-visible" viewBox="0 0 16 40">
        <path d="M8 4 C 15 14, 14 26, 8 36" fill="none" stroke="var(--safety)" strokeLinecap="round" strokeWidth="3" />
      </svg>
      <ZipTag className="absolute top-[7px] left-[-13px]" rest={78}>
        New hire
        <br />
        Roary-01
      </ZipTag>
    </div>
  );
}

function IdBadge() {
  return (
    <div className="absolute bottom-[5%] left-[7%] w-[min(62%,17rem)] -rotate-[4deg] text-ink">
      <span aria-hidden className="mx-auto block h-5 w-10 rounded-t-[3px] border-2 border-ink border-b-0 bg-label" />
      <div className="plate flex flex-col gap-3 bg-cotton p-4 shadow-[0_18px_30px_-12px_rgb(0_0_0/0.6)]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs uppercase">Crew ID</span>
          <span aria-hidden className="barcode block h-4 w-20" />
        </div>
        <div className="flex gap-3">
          <div className="grid aspect-square w-20 shrink-0 place-items-center border-2 border-ink bg-label">
            <span aria-label="Roary the lion" className="text-5xl leading-none" role="img">
              🦁
            </span>
          </div>
          <dl className="grid content-start gap-0.5 font-mono text-[11px] uppercase leading-snug">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="type-display text-2xl leading-none">Roary</dd>
            <dt className="mt-1 text-muted-foreground">Clearance</dt>
            <dd>Opens PRs</dd>
            <dd className="bg-ink px-1 text-cotton">Never merges</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function FirstDay() {
  return (
    <section
      aria-labelledby="first-day-title"
      className="ripstop scroll-mt-0 border-ink border-y-2 text-cotton"
      id="first-day"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-5 lg:sticky lg:top-10 lg:self-start">
          <h2 className="quoted type-display text-6xl sm:text-8xl" id="first-day-title">
            First day
          </h2>
          <p className="max-w-md text-lg leading-relaxed opacity-90">
            What a shift with Roary looks like, from the first alert to the launch video.
          </p>
          <span className="w-fit border-2 border-cotton px-2 py-1 font-mono text-xs uppercase">
            Example shift · sample data
          </span>
        </div>
        <ol className="flex flex-col">
          {SHIFT.map((entry) => (
            <li
              className="grid grid-cols-[5.5rem_1fr] gap-x-5 gap-y-3 border-cotton/30 border-t-2 py-7 sm:grid-cols-[8rem_1fr]"
              key={entry.time}
            >
              <time className="type-display text-4xl text-safety tabular-nums sm:text-5xl">
                {entry.time}
              </time>
              <div className="flex flex-col gap-2">
                <h3 className="quoted type-display text-3xl sm:text-4xl">{entry.title}</h3>
                <p className="max-w-xl leading-relaxed opacity-85">{entry.body}</p>
                {entry.time === "09:11" ? <RoaryNote /> : null}
                {entry.time === "17:30" ? <LaunchFrame /> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function RoaryNote() {
  return (
    <figure className="plate mt-3 flex flex-col gap-3 bg-cotton p-5 text-ink">
      <figcaption className="font-mono text-xs uppercase">Roary · comment on the fix PR</figcaption>
      <p>
        <span className="mr-2 bg-label px-1.5 font-mono text-xs uppercase">What I saw</span>
        <code className="font-mono text-sm">Cannot read properties of undefined (reading 'lineTotal')</code> in{" "}
        <code className="font-mono text-sm">priceCart()</code>, starting with the 09:00 deploy.
      </p>
      <p>
        <span className="mr-2 bg-safety px-1.5 font-mono text-xs uppercase">What I think</span>
        8d41418 reads <code className="font-mono text-sm">lines[1]</code> without checking it exists, so
        single-item carts fail. This PR guards it and adds a test. Happy to adjust before someone merges.
      </p>
    </figure>
  );
}

function LaunchFrame() {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="relative grid aspect-video w-full max-w-md place-items-center overflow-hidden rounded-[3px] border-2 border-cotton bg-ink">
        <span aria-hidden className="hazard-on-safety absolute inset-x-0 bottom-0 h-3" />
        <p className="type-display text-4xl sm:text-5xl">{'"Dark mode"'}</p>
        <span className="absolute top-3 left-3 grid size-10 place-items-center rounded-full border-2 border-cotton">
          <PlayIcon className="size-4 fill-current" />
        </span>
        <span className="absolute top-3 right-3 font-mono text-xs">00:24</span>
      </div>
      <span className="font-mono text-xs uppercase opacity-80">Launch video · example frame</span>
    </div>
  );
}

function HouseRules() {
  return (
    <section aria-labelledby="rules-title" className="bg-safety text-ink">
      <div aria-hidden className="hazard-on-safety h-6 border-ink border-b-2" />
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <h2 className="quoted type-display text-6xl sm:text-8xl" id="rules-title">
            House rules
          </h2>
          <p className="max-w-md text-lg leading-relaxed">
            Roary proposes. Humans merge. These are part of the job, not settings.
          </p>
        </div>
        <ul className="flex flex-col">
          {HOUSE_RULES.map((rule) => (
            <li className="quoted border-ink border-b-2 py-4 type-display text-5xl first:border-t-2 sm:text-7xl" key={rule}>
              {rule}
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden className="hazard-on-safety h-6 border-ink border-t-2" />
    </section>
  );
}

function OfferLetter() {
  return (
    <section aria-labelledby="offer-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="plate relative mx-auto flex max-w-3xl overflow-hidden bg-card">
        <span aria-hidden className="hazard my-8 ml-6 w-3 shrink-0 border-2 border-ink sm:ml-8 sm:w-4" />
        <div className="flex min-w-0 flex-1 flex-col gap-8 py-10 pr-6 pl-5 sm:py-12 sm:pr-12 sm:pl-10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-ink border-b-2 pb-4 font-mono text-xs uppercase">
            <span>ID: offer-roary-01 · Issued today</span>
            <span aria-hidden className="barcode block h-5 w-28" />
          </div>
          <h2 className="quoted type-display text-6xl sm:text-7xl" id="offer-title">
            Offer letter
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 font-mono uppercase sm:text-lg">
            <dt className="text-muted-foreground">Position</dt>
            <dd>AI engineer</dd>
            <dt className="text-muted-foreground">Reports to</dt>
            <dd>Your team</dd>
            <dt className="text-muted-foreground">Start date</dt>
            <dd>Today</dd>
            <dt className="text-muted-foreground">You choose</dt>
            <dd>Name, look, personality, jobs</dd>
          </dl>
          <div className="relative flex flex-col gap-6 border-ink border-t-2 border-dashed pt-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <span className="block h-10 w-64 max-w-full border-ink border-b-2" />
              <span className="font-mono text-xs uppercase">Signature · your team</span>
            </div>
            <span
              aria-hidden
              className="pointer-events-none absolute top-8 right-0 rotate-[-8deg] border-[3px] border-safety bg-card/70 px-2 py-1 font-mono text-safety text-xs uppercase outline-2 outline-safety outline-offset-2 sm:-top-20 sm:px-3 sm:py-1.5 sm:text-sm"
            >
              Issued · Roary-01
            </span>
            <Link
              className="plate inline-flex items-center justify-center gap-3 whitespace-nowrap bg-safety px-5 py-4 font-mono text-base text-ink uppercase transition-transform hover:-translate-y-0.5 sm:px-6 sm:text-lg"
              href="/hire"
            >
              Sign the offer letter
              <ArrowRightIcon className="size-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
