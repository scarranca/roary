# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Hackathon judges** (Vercel Fast Forward, Oct 14 2026) watching a 3-minute live demo, usually on a projector. They score Usefulness, Creativity and Impact equally and must understand the idea in one glance.
- **Small dev teams** on Vercel + GitHub + Sentry + PostHog who ship fast, break things, and have no one watching errors or announcing launches. They decide whether to "hire" Roary for real.
Both audiences matter equally for the landing page.

## Product Purpose
Roary is an AI engineer that a team hires, not a tool it configures. It notices when something breaks (Sentry), checks real user impact (PostHog), finds the likely culprit commit (GitHub), opens a fix PR, reviews recent launches (Vercel deploys), and makes a launch video when a feature ships (HyperFrames). Success: shorter time from "users hit an error" to "fix merged", and launches that actually get celebrated.

## Positioning
Framed as a hire: Roary gets a name, a personality, access to the stack and a job description, then takes initiative. It is the only agent we know of that celebrates launches by turning merged PRs into launch videos automatically. Humans always merge.

## Operating Context
- Front end "Hire Roary": `/` landing, `/hire` character-builder wizard (name & look, personality sliders, jobs + autonomy, "Sign the offer letter 🦁"), `/desk` live activity feed + chat with Roary.
- Roary speaks in chat, GitHub PR comments and launch reports.
- Built on Vercel eve, AI Gateway, Vercel Connect, Sandbox, Blob, Neon Postgres.

## Capabilities and Constraints
- Jobs: triage errors, open fix PRs, review launches, make launch videos. Autonomy: suggest only, or open PRs.
- Roary never merges, force-pushes, rolls back or changes settings; it may only suggest.
- Undecided: pricing, real customers, public availability beyond the hackathon.

## Brand Commitments
- Name: Roary. The default Roary is a lion (🦁 or drawn); keep the lion as the brand character.
- Each team builds its own Roary as a 3D designer vinyl toy and may choose any character, including one generated from a picture they upload (decided Oct 14 2026). The figure moves: idle, reactions, a roar when the offer letter is signed.
- Company swag comes from an uploaded logo, printed on the figure's clothes.
- Voice: friendly, mindful, calm, never blames people ("the change", not "your mistake"); always separates "what I saw" from "what I think"; celebrates the people who shipped.
- Tagline in use: "The teammate you hire, not the tool you configure."

## Evidence on Hand
- No customers, testimonials, benchmarks or usage numbers exist. Never invent them.
- Demonstration content (sample incidents, sample Roary messages) is allowed only when labeled as an example.

## Product Principles
1. A hire, not a config screen: every surface leans into the hiring metaphor.
2. Honest about confidence: show what Roary saw versus what it thinks.
3. Humans stay in charge: Roary proposes, people merge.
4. Speak up only when it matters: real user impact, regressions, launches.
5. Celebrate shipping.
