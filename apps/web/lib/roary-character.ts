import { z } from "zod";

// The toy kit: every Roary is assembled from these parts. Claude fills the same
// shape when it turns an uploaded picture into a character, so keep the
// descriptions written for the model.
// No regex here: some providers reject `pattern` in structured output. Colors are normalized after.
const color = z.string().describe("Six-digit hex color like #f2c27a");

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Replaces any malformed color the model returns with a safe fallback. */
export function sanitizeCharacter(character: Character, fallback = "#c9ced6"): Character {
  const fix = (value: string) => (HEX.test(value) ? value : fallback);
  return {
    ...character,
    species: character.species.slice(0, 40),
    head: { ...character.head, color: fix(character.head.color) },
    ears: { ...character.ears, color: fix(character.ears.color) },
    mane: { ...character.mane, color: fix(character.mane.color) },
    muzzle: { ...character.muzzle, color: fix(character.muzzle.color) },
    eyes: { ...character.eyes, color: fix(character.eyes.color) },
    tail: { ...character.tail, color: fix(character.tail.color) },
    body: { color: fix(character.body.color) },
  };
}

export const characterSchema = z.object({
  species: z.string().min(1).max(40).describe("What the character is, in one or two words, e.g. 'lion' or 'robot'"),
  head: z.object({
    shape: z.enum(["round", "square", "oval"]).describe("Overall head silhouette"),
    color,
  }),
  ears: z.object({
    kind: z
      .enum(["round", "pointy", "floppy", "long", "none"])
      .describe("round: bear/lion, pointy: cat/fox, floppy: dog, long: rabbit"),
    color,
  }),
  mane: z.object({
    kind: z.enum(["none", "lion", "fluffy", "spiky"]).describe("Hair or mane framing the face"),
    color,
  }),
  muzzle: z.object({
    kind: z.enum(["none", "small", "wide", "beak"]).describe("Snout shape on the lower face"),
    color,
  }),
  eyes: z.object({
    kind: z.enum(["dot", "round", "visor"]).describe("visor suits robots and helmets"),
    color,
  }),
  extra: z.enum(["none", "antenna", "horns"]).describe("Something on top of the head"),
  tail: z.object({
    kind: z.enum(["none", "lion", "fluffy", "stub"]),
    color,
  }),
  body: z.object({ color }).describe("Skin or fur color of the hands and feet"),
});

export type Character = z.infer<typeof characterSchema>;

export type Outfit = "crew" | "hoodie" | "tee";
export type Headwear = "none" | "cap" | "beanie" | "headphones";

export type RoaryLook = {
  character: Character;
  outfit: Outfit;
  outfitColor: string;
  accentColor: string;
  headwear: Headwear;
  /** PNG data URL, normalized from whatever the team uploaded. */
  logo?: string;
  /** Patch color behind the logo, chosen to contrast with it. */
  logoPatch?: string;
};

export type Preset = { id: string; label: string; character: Character };

// The rest of a hire. Shared with the agent side (#15 / #16), so keep it free of UI code.
export type Personality = { playful: number; detailed: number; proactive: number; emoji: number };
export type Jobs = { triage: boolean; fixPrs: boolean; launchReview: boolean; launchVideo: boolean };
export type Autonomy = "suggest" | "open_prs";

export const DEFAULT_PERSONALITY: Personality = { playful: 55, detailed: 50, proactive: 55, emoji: 35 };
export const DEFAULT_JOBS: Jobs = { triage: true, fixPrs: true, launchReview: true, launchVideo: true };

/** Everything a team chose in the fitting room. */
export type HiredRoary = {
  name: string;
  look: RoaryLook;
  personality: Personality;
  jobs: Jobs;
  autonomy: Autonomy;
  /** PNG data URL of the figure, taken when the offer letter was signed. */
  snapshot?: string;
  hiredAt: string;
  /** Row id in roary_profiles once the hire is saved to Neon (#15). */
  profileId?: number;
};

const SPECIES_EMOJI: [RegExp, string][] = [
  [/lion/i, "🦁"],
  [/fox/i, "🦊"],
  [/bear/i, "🐻"],
  [/bunny|rabbit/i, "🐰"],
  [/robot|bot/i, "🤖"],
  [/frog|toad/i, "🐸"],
  [/cat|kitten/i, "🐱"],
  [/dog|puppy/i, "🐶"],
  [/owl|bird/i, "🦉"],
  [/penguin/i, "🐧"],
];

/** An emoji for the character, used in sample messages; ✨ when we can't tell. */
export function speciesEmoji(species: string) {
  return SPECIES_EMOJI.find(([pattern]) => pattern.test(species))?.[1] ?? "✨";
}

const lion: Character = {
  species: "lion",
  head: { shape: "round", color: "#f2c27a" },
  ears: { kind: "round", color: "#f2c27a" },
  mane: { kind: "lion", color: "#c8641d" },
  muzzle: { kind: "wide", color: "#fbe6c4" },
  eyes: { kind: "dot", color: "#0a0a0a" },
  extra: "none",
  tail: { kind: "lion", color: "#f2c27a" },
  body: { color: "#f2c27a" },
};

export const PRESETS: Preset[] = [
  { id: "roary", label: "Roary", character: lion },
  {
    id: "lioness",
    label: "Lioness",
    character: { ...lion, species: "lioness", mane: { kind: "none", color: "#c8641d" }, head: { shape: "oval", color: "#e8b46a" } },
  },
  {
    id: "snow",
    label: "Snow lion",
    character: {
      ...lion,
      species: "snow lion",
      head: { shape: "round", color: "#f4f1ea" },
      ears: { kind: "round", color: "#f4f1ea" },
      mane: { kind: "fluffy", color: "#d9dde3" },
      muzzle: { kind: "wide", color: "#ffffff" },
      tail: { kind: "lion", color: "#f4f1ea" },
      body: { color: "#f4f1ea" },
    },
  },
  {
    id: "fox",
    label: "Fox",
    character: {
      species: "fox",
      head: { shape: "oval", color: "#e8742c" },
      ears: { kind: "pointy", color: "#e8742c" },
      mane: { kind: "none", color: "#e8742c" },
      muzzle: { kind: "small", color: "#fff4e8" },
      eyes: { kind: "dot", color: "#0a0a0a" },
      extra: "none",
      tail: { kind: "fluffy", color: "#e8742c" },
      body: { color: "#2b2420" },
    },
  },
  {
    id: "bear",
    label: "Bear",
    character: {
      species: "bear",
      head: { shape: "round", color: "#7a4f2e" },
      ears: { kind: "round", color: "#7a4f2e" },
      mane: { kind: "none", color: "#7a4f2e" },
      muzzle: { kind: "wide", color: "#d9b38c" },
      eyes: { kind: "dot", color: "#0a0a0a" },
      extra: "none",
      tail: { kind: "stub", color: "#7a4f2e" },
      body: { color: "#7a4f2e" },
    },
  },
  {
    id: "bunny",
    label: "Bunny",
    character: {
      species: "bunny",
      head: { shape: "oval", color: "#f3eee8" },
      ears: { kind: "long", color: "#f3eee8" },
      mane: { kind: "none", color: "#f3eee8" },
      muzzle: { kind: "small", color: "#ffd6dc" },
      eyes: { kind: "round", color: "#0a0a0a" },
      extra: "none",
      tail: { kind: "fluffy", color: "#ffffff" },
      body: { color: "#f3eee8" },
    },
  },
  {
    id: "robot",
    label: "Robot",
    character: {
      species: "robot",
      head: { shape: "square", color: "#c9ced6" },
      ears: { kind: "none", color: "#c9ced6" },
      mane: { kind: "none", color: "#c9ced6" },
      muzzle: { kind: "none", color: "#c9ced6" },
      eyes: { kind: "visor", color: "#29e0ff" },
      extra: "antenna",
      tail: { kind: "none", color: "#c9ced6" },
      body: { color: "#8b929c" },
    },
  },
];

export const DEFAULT_LOOK: RoaryLook = {
  character: lion,
  outfit: "crew",
  outfitColor: "#1a1a1a",
  accentColor: "#ff5a00",
  headwear: "none",
};

const level = (value: number, low: string, high: string) =>
  value < 34 ? `mostly ${low}` : value > 66 ? `very ${high}` : `balanced between ${low} and ${high}`;

/**
 * Turns a hire into context for the agent, sent with every chat turn (eve's
 * clientContext). Roary's instructions already say to follow what the team
 * chose at hire; the guardrails stay the same.
 */
export function hireContext(hired: HiredRoary): string {
  const { name, look, personality: p, jobs, autonomy } = hired;
  const on = [
    jobs.triage && "triage errors",
    jobs.fixPrs && "open fix PRs",
    jobs.launchReview && "review launches",
    jobs.launchVideo && "make launch videos",
  ].filter(Boolean);
  return [
    `The team hired you in the fitting room. Your name is ${name}, a ${look.character.species}. Introduce yourself with that name.`,
    `Voice: ${level(p.playful, "professional", "playful")}; ${level(p.detailed, "concise", "detailed")}; ${level(p.proactive, "quiet", "proactive")}. Emoji: ${p.emoji < 20 ? "none" : p.emoji > 66 ? "plenty" : "a few"}.`,
    `Jobs you were hired for: ${on.length ? on.join(", ") : "none yet"}. For work outside these, offer to help but say it is not in your job description.`,
    `When you find a fix: ${autonomy === "open_prs" ? "you may open the pull request" : "suggest the patch and ask before opening a pull request"}. Humans always merge.`,
  ].join("\n");
}
