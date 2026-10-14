import type { Character } from "@/lib/roary-character";

const INK = "#0a0a0a";
const CX = 32;
const CY = 38;

/** Points of a star polygon around the head center, used for the lion mane. */
function starPoints(spikes: number, outer: number, inner: number) {
  return Array.from({ length: spikes * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

function Mane({ c }: { readonly c: Character }) {
  const { kind, color } = c.mane;
  if (kind === "lion") return <polygon fill={color} points={starPoints(14, 24.5, 19)} stroke={INK} strokeLinejoin="round" />;
  if (kind === "fluffy") {
    return (
      <g fill={color} stroke={INK}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI * 2 * i) / 12;
          return <circle cx={CX + 19 * Math.cos(a)} cy={CY + 19 * Math.sin(a)} key={a} r={6.5} />;
        })}
      </g>
    );
  }
  if (kind === "spiky") return <polygon fill={color} points="17,30 20,14 26,24 32,10 38,24 44,14 47,30" stroke={INK} strokeLinejoin="round" />;
  return null;
}

function Ears({ c }: { readonly c: Character }) {
  const { kind, color } = c.ears;
  const inner = c.muzzle.kind === "none" ? color : c.muzzle.color;
  if (kind === "round") {
    return (
      <g stroke={INK}>
        <circle cx={19} cy={25} fill={color} r={6.5} />
        <circle cx={45} cy={25} fill={color} r={6.5} />
        <circle cx={19} cy={25} fill={inner} r={3} strokeWidth={1.5} />
        <circle cx={45} cy={25} fill={inner} r={3} strokeWidth={1.5} />
      </g>
    );
  }
  if (kind === "pointy") {
    return (
      <g stroke={INK} strokeLinejoin="round">
        <polygon fill={color} points="17,32 18,8 31,24" />
        <polygon fill={color} points="47,32 46,8 33,24" />
        <polygon fill={INK} points="20,25 20.5,14 26,22" stroke="none" />
        <polygon fill={INK} points="44,25 43.5,14 38,22" stroke="none" />
      </g>
    );
  }
  if (kind === "floppy") {
    return (
      <g fill={color} stroke={INK}>
        <ellipse cx={16} cy={38} rx={5.5} ry={11} transform="rotate(15 16 38)" />
        <ellipse cx={48} cy={38} rx={5.5} ry={11} transform="rotate(-15 48 38)" />
      </g>
    );
  }
  if (kind === "long") {
    return (
      <g stroke={INK}>
        <ellipse cx={25} cy={14} fill={color} rx={5} ry={12} transform="rotate(-8 25 14)" />
        <ellipse cx={39} cy={14} fill={color} rx={5} ry={12} transform="rotate(8 39 14)" />
        <ellipse cx={25} cy={15} fill={inner} rx={2.2} ry={8} stroke="none" transform="rotate(-8 25 15)" />
        <ellipse cx={39} cy={15} fill={inner} rx={2.2} ry={8} stroke="none" transform="rotate(8 39 15)" />
      </g>
    );
  }
  return null;
}

function Extra({ c }: { readonly c: Character }) {
  if (c.extra === "antenna") {
    return (
      <g stroke={INK}>
        <line x1={CX} x2={CX} y1={23} y2={10} />
        <circle cx={CX} cy={8} fill={c.eyes.kind === "visor" ? c.eyes.color : "#ff5a00"} r={3.5} />
      </g>
    );
  }
  if (c.extra === "horns") {
    return (
      <g fill="#f4f1ea" stroke={INK} strokeLinejoin="round">
        <path d="M22 26 Q16 16 20 8 Q24 18 28 24 Z" />
        <path d="M42 26 Q48 16 44 8 Q40 18 36 24 Z" />
      </g>
    );
  }
  return null;
}

function Head({ c }: { readonly c: Character }) {
  const { shape, color } = c.head;
  if (shape === "square") return <rect fill={color} height={30} rx={5} stroke={INK} width={32} x={16} y={23} />;
  if (shape === "oval") return <ellipse cx={CX} cy={CY} fill={color} rx={13.5} ry={16} stroke={INK} />;
  return <circle cx={CX} cy={CY} fill={color} r={15.5} stroke={INK} />;
}

function Face({ c }: { readonly c: Character }) {
  const { eyes, muzzle } = c;
  const eyeY = muzzle.kind === "none" ? CY : CY - 3;
  return (
    <g stroke={INK}>
      {eyes.kind === "visor" ? (
        <rect fill={eyes.color} height={8} rx={3} width={24} x={20} y={eyeY - 4} />
      ) : eyes.kind === "round" ? (
        <>
          <circle cx={26} cy={eyeY} fill="#ffffff" r={3.6} strokeWidth={1.5} />
          <circle cx={38} cy={eyeY} fill="#ffffff" r={3.6} strokeWidth={1.5} />
          <circle cx={26.6} cy={eyeY + 0.4} fill={eyes.color} r={1.9} stroke="none" />
          <circle cx={38.6} cy={eyeY + 0.4} fill={eyes.color} r={1.9} stroke="none" />
        </>
      ) : (
        <>
          <circle cx={26} cy={eyeY} fill={eyes.color} r={2.2} stroke="none" />
          <circle cx={38} cy={eyeY} fill={eyes.color} r={2.2} stroke="none" />
        </>
      )}
      {muzzle.kind === "wide" ? <ellipse cx={CX} cy={CY + 7} fill={muzzle.color} rx={9} ry={6} strokeWidth={1.5} /> : null}
      {muzzle.kind === "small" ? <ellipse cx={CX} cy={CY + 7} fill={muzzle.color} rx={5.5} ry={4} strokeWidth={1.5} /> : null}
      {muzzle.kind === "beak" ? (
        <polygon fill={muzzle.color} points={`${CX - 5},${CY + 3} ${CX + 5},${CY + 3} ${CX},${CY + 11}`} strokeLinejoin="round" strokeWidth={1.5} />
      ) : null}
      {muzzle.kind === "wide" || muzzle.kind === "small" ? (
        <>
          <ellipse cx={CX} cy={CY + 4.5} fill={INK} rx={2.4} ry={1.6} stroke="none" />
          <path d={`M${CX} ${CY + 6} v2.5 M${CX - 3} ${CY + 9.5} Q${CX} ${CY + 11.5} ${CX + 3} ${CY + 9.5}`} fill="none" strokeLinecap="round" strokeWidth={1.5} />
        </>
      ) : null}
      {muzzle.kind === "none" && eyes.kind === "visor" ? (
        <path d={`M${CX - 5} ${CY + 9} h10`} strokeLinecap="round" strokeWidth={2} />
      ) : null}
    </g>
  );
}

/** A flat vinyl-toy portrait of a character's head, drawn from its spec so it works for any picture-built character too. */
export function CharacterIcon({ character, size = 56, className }: { readonly character: Character; readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden className={className} height={size} strokeWidth={2.5} viewBox="0 0 64 64" width={size}>
      <Mane c={character} />
      {character.ears.kind === "long" ? null : <Ears c={character} />}
      <Extra c={character} />
      {character.ears.kind === "long" ? <Ears c={character} /> : null}
      <Head c={character} />
      <Face c={character} />
    </svg>
  );
}
