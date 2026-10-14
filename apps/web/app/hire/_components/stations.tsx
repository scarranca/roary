"use client";

import { ImageUpIcon, LoaderIcon, UploadIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { type Character, type Headwear, type Outfit, PRESETS, type RoaryLook } from "@/lib/roary-character";
import { brandColorsFromImage, prepareLogo } from "./brand-colors";

const FUR = ["#f2c27a", "#e8742c", "#7a4f2e", "#f4f1ea", "#3b3b3b", "#c9ced6"];
const MANE = ["#c8641d", "#7a3a14", "#2b2420", "#d9dde3", "#ff5a00", "#2433a8"];
const CLOTH = ["#1a1a1a", "#f4f4f2", "#ff5a00", "#2433a8", "#1f5a3a", "#5b2a6e"];

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 font-mono text-muted-foreground text-xs uppercase">{label}</legend>
      {children}
    </fieldset>
  );
}

export function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 4,
}: {
  readonly options: readonly { value: T; label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly columns?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={cn(
            "rounded-[3px] border-2 border-ink px-2 py-2.5 font-mono text-xs uppercase transition-colors",
            option.value === value ? "bg-safety" : "bg-card hover:bg-label",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Swatches({
  colors,
  value,
  onChange,
  label,
}: {
  readonly colors: readonly string[];
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color) => (
        <button
          aria-label={`${label} ${color}`}
          aria-pressed={color.toLowerCase() === value.toLowerCase()}
          className={cn(
            "size-9 rounded-[3px] border-2 border-ink transition-transform hover:-translate-y-0.5",
            color.toLowerCase() === value.toLowerCase() && "outline-[3px] outline-safety outline-offset-2",
          )}
          key={color}
          onClick={() => onChange(color)}
          style={{ background: color }}
          type="button"
        />
      ))}
    </div>
  );
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Shrinks a photo to fit 1024px as JPEG so phone pictures stay far below upload limits. */
async function shrinkForUpload(dataUrl: string) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const max = 1024;
  const scale = Math.min(1, max / Math.max(image.naturalWidth || max, image.naturalHeight || max));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((image.naturalWidth || max) * scale);
  canvas.height = Math.round((image.naturalHeight || max) * scale);
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  // JPEG has no transparency: put logos with alpha on white instead of black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A picture on its way to becoming a toy, shown on the stage while Claude reads it. */
export type PictureStudy = { status: "working" | "error" | "done"; preview: string; character?: Character };

function PictureToToy({
  onCharacter,
  onStudy,
}: {
  readonly onCharacter: (character: Character) => void;
  readonly onStudy?: (study: PictureStudy) => void;
}) {
  const inputId = useId();
  const [state, setState] = useState<{ status: "idle" | "working" | "error"; preview?: string; error?: string }>({
    status: "idle",
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const original = await readAsDataUrl(file);
    setState({ status: "working", preview: original });
    onStudy?.({ status: "working", preview: original });
    try {
      const image = await shrinkForUpload(original);
      const response = await fetch("/api/character", {
        body: JSON.stringify({ image }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      // Platform errors (413, 504) come back as HTML, not JSON.
      const body = (await response.json().catch(() => ({}))) as { character?: Character; error?: string };
      if (!response.ok || !body.character) {
        throw new Error(body.error ?? `Roary couldn't read that picture (error ${response.status}). Try a smaller one.`);
      }
      onCharacter(body.character);
      onStudy?.({ status: "done", preview: original, character: body.character });
      setState({ status: "idle", preview: original });
    } catch (error) {
      setState({ status: "error", preview: original, error: error instanceof Error ? error.message : String(error) });
      onStudy?.({ status: "error", preview: original });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-[3px] border-2 border-ink border-dashed p-3 hover:bg-label has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-safety has-[:focus-visible]:outline-offset-2",
          state.status === "working" ? "bg-label" : "bg-card",
        )}
        htmlFor={inputId}
      >
        {state.preview ? (
          // biome-ignore lint/performance/noImgElement: local data URL preview
          <img alt="Your picture" className="size-14 rounded-[2px] border-2 border-ink object-cover" src={state.preview} />
        ) : (
          <span className="grid size-14 place-items-center rounded-[2px] border-2 border-ink bg-safety">
            <ImageUpIcon className="size-6" />
          </span>
        )}
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="type-display text-2xl leading-none">
            {state.status === "working" ? "Studying your picture…" : "Build from a picture"}
          </span>
          <span className="font-mono text-muted-foreground text-xs uppercase">
            Your mascot, pet, sketch or logo becomes a toy
          </span>
        </span>
        {state.status === "working" ? <LoaderIcon className="size-5 animate-spin" /> : null}
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          disabled={state.status === "working"}
          id={inputId}
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
      {state.status === "error" ? (
        <p className="font-mono text-broken text-xs uppercase" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

export function PickStation({
  look,
  name,
  presetId,
  onName,
  onPreset,
  onCharacter,
  onStudy,
}: {
  readonly look: RoaryLook;
  readonly name: string;
  readonly presetId: string;
  readonly onName: (name: string) => void;
  readonly onPreset: (id: string) => void;
  readonly onCharacter: (character: Character) => void;
  readonly onStudy?: (study: PictureStudy) => void;
}) {
  const nameId = useId();
  return (
    <div className="flex flex-col gap-7">
      <Field label="Character">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESETS.map((preset) => {
            const c = preset.character;
            return (
              <button
                aria-pressed={preset.id === presetId}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-[3px] border-2 border-ink p-3 text-left transition-colors",
                  preset.id === presetId ? "bg-safety" : "bg-card hover:bg-label",
                )}
                key={preset.id}
                onClick={() => onPreset(preset.id)}
                type="button"
              >
                <span className="type-display text-2xl leading-none">{preset.label}</span>
                <span aria-hidden className="flex gap-1">
                  {[c.head.color, c.mane.kind === "none" ? c.ears.color : c.mane.color, c.muzzle.color].map((color, i) => (
                    <span className="size-4 rounded-[2px] border-[1.5px] border-ink" key={`${color}-${i}`} style={{ background: color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label={`Or any character · now: ${look.character.species}`}>
        <PictureToToy onCharacter={onCharacter} onStudy={onStudy} />
      </Field>
      <div className="flex flex-col gap-2.5">
        <label className="font-mono text-muted-foreground text-xs uppercase" htmlFor={nameId}>
          Name
        </label>
        <input
          className="rounded-[3px] border-2 border-ink bg-card px-3 py-2.5 type-display text-3xl uppercase outline-none focus-visible:outline-2 focus-visible:outline-safety"
          id={nameId}
          maxLength={20}
          onChange={(event) => onName(event.target.value)}
          value={name}
        />
      </div>
    </div>
  );
}

export function FitStation({
  look,
  onChange,
}: {
  readonly look: RoaryLook;
  readonly onChange: (look: RoaryLook) => void;
}) {
  const { character } = look;
  const furry = character.eyes.kind !== "visor";
  const uploadId = useId();

  const setFur = (color: string) =>
    onChange({
      ...look,
      character: {
        ...character,
        head: { ...character.head, color },
        ears: { ...character.ears, color },
        body: { color },
        tail: { ...character.tail, color },
      },
    });

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const [{ png, patch }, { primary, accent }] = await Promise.all([
      prepareLogo(dataUrl),
      brandColorsFromImage(dataUrl),
    ]);
    onChange({
      ...look,
      logo: png,
      logoPatch: patch,
      outfitColor: primary ?? look.outfitColor,
      accentColor: accent ?? look.accentColor,
    });
  };

  return (
    <div className="flex flex-col gap-7">
      <Field label="Your logo">
        {look.logo ? (
          <div className="flex items-center gap-3 rounded-[3px] border-2 border-ink bg-card p-3">
            {/* biome-ignore lint/performance/noImgElement: local data URL preview */}
            <img alt="Uploaded logo" className="size-12 rounded-[2px] border-2 border-ink bg-cotton object-contain p-1" src={look.logo} />
            <p className="flex-1 font-mono text-xs uppercase">Sewn on the chest, the back and the cap. Brand colors applied. Spin to see the back.</p>
            <button
              aria-label="Remove logo"
              className="grid size-9 place-items-center rounded-[3px] border-2 border-ink hover:bg-label"
              onClick={() => onChange({ ...look, logo: undefined })}
              type="button"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <label
            className="flex cursor-pointer items-center justify-between gap-3 rounded-[3px] border-2 border-ink border-dashed bg-card p-4 font-mono text-xs uppercase hover:bg-label has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-safety has-[:focus-visible]:outline-offset-2"
            htmlFor={uploadId}
          >
            <span>Drop your startup's logo · SVG or PNG</span>
            <UploadIcon className="size-4" />
            <input
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="sr-only"
              id={uploadId}
              onChange={(event) => void onLogo(event.target.files?.[0])}
              type="file"
            />
          </label>
        )}
      </Field>

      <Field label="Outfit">
        <OptionGrid<Outfit>
          columns={3}
          onChange={(outfit) => onChange({ ...look, outfit })}
          options={[
            { value: "crew", label: "Crew jacket" },
            { value: "hoodie", label: "Hoodie" },
            { value: "tee", label: "Tee" },
          ]}
          value={look.outfit}
        />
        <Swatches
          colors={look.logo ? [look.outfitColor, ...CLOTH.filter((c) => c !== look.outfitColor)] : CLOTH}
          label="Outfit color"
          onChange={(outfitColor) => onChange({ ...look, outfitColor })}
          value={look.outfitColor}
        />
      </Field>

      <Field label="Headwear">
        <OptionGrid<Headwear>
          onChange={(headwear) => onChange({ ...look, headwear })}
          options={[
            { value: "none", label: "None" },
            { value: "cap", label: "Cap" },
            { value: "beanie", label: "Beanie" },
            { value: "headphones", label: "Phones" },
          ]}
          value={look.headwear}
        />
      </Field>

      <Field label="Accent · zips, laces, cap">
        <Swatches
          colors={look.logo ? [look.accentColor, ...CLOTH.filter((c) => c !== look.accentColor)] : CLOTH}
          label="Accent color"
          onChange={(accentColor) => onChange({ ...look, accentColor })}
          value={look.accentColor}
        />
      </Field>

      {furry ? (
        <Field label="Fur">
          <Swatches colors={FUR} label="Fur color" onChange={setFur} value={character.head.color} />
        </Field>
      ) : null}
      {character.mane.kind !== "none" ? (
        <Field label="Mane">
          <Swatches
            colors={MANE}
            label="Mane color"
            onChange={(color) => onChange({ ...look, character: { ...character, mane: { ...character.mane, color } } })}
            value={character.mane.color}
          />
        </Field>
      ) : null}
    </div>
  );
}
