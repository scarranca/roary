"use client";

import { RoundedBox, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Character, Headwear, RoaryLook } from "@/lib/roary-character";

// Satin vinyl, like a designer toy: a little clearcoat over a matte base.
function Vinyl({ color, emissive }: { readonly color: string; readonly emissive?: boolean }) {
  return (
    <meshPhysicalMaterial
      clearcoat={0.45}
      clearcoatRoughness={0.35}
      color={color}
      emissive={emissive ? color : "#000000"}
      emissiveIntensity={emissive ? 0.9 : 0}
      roughness={0.5}
    />
  );
}

function Ball({
  color,
  position,
  radius,
  scale,
}: {
  readonly color: string;
  readonly position: [number, number, number];
  readonly radius: number;
  readonly scale?: [number, number, number];
}) {
  return (
    <mesh castShadow position={position} scale={scale}>
      <sphereGeometry args={[radius, 32, 24]} />
      <Vinyl color={color} />
    </mesh>
  );
}

function Capsule({
  color,
  length,
  position,
  radius,
  rotation,
}: {
  readonly color: string;
  readonly length: number;
  readonly position: [number, number, number];
  readonly radius: number;
  readonly rotation?: [number, number, number];
}) {
  return (
    <mesh castShadow position={position} rotation={rotation}>
      <capsuleGeometry args={[radius, length, 8, 16]} />
      <Vinyl color={color} />
    </mesh>
  );
}

/** How far the head's surface sits from its center, per shape (x, y, z). */
const HEAD_SIZE = {
  round: [0.8, 0.76, 0.76],
  oval: [0.72, 0.84, 0.72],
  square: [0.74, 0.68, 0.66],
} as const;

function Head({
  character,
  headwear,
  accent,
  logo,
  logoPatch,
  blinkRef,
  mouthRef,
}: {
  readonly character: Character;
  readonly headwear: Headwear;
  readonly accent: string;
  readonly logo?: string;
  readonly logoPatch?: string;
  readonly blinkRef: React.RefObject<THREE.Group | null>;
  readonly mouthRef: React.RefObject<THREE.Mesh | null>;
}) {
  const [sx, sy, sz] = HEAD_SIZE[character.head.shape];
  const faceZ = sz - 0.04;

  return (
    <>
      {character.head.shape === "square" ? (
        <RoundedBox args={[sx * 2, sy * 2, sz * 2]} castShadow radius={0.28} smoothness={5}>
          <Vinyl color={character.head.color} />
        </RoundedBox>
      ) : (
        <Ball color={character.head.color} position={[0, 0, 0]} radius={1} scale={[sx, sy, sz]} />
      )}

      <Mane character={character} />
      <Ears character={character} />

      <group ref={blinkRef} position={[0, 0.08, faceZ]}>
        <Eyes character={character} />
      </group>

      <Muzzle character={character} faceZ={faceZ} mouthRef={mouthRef} />

      {character.extra === "antenna" ? (
        <group position={[0, sy, 0]}>
          <mesh castShadow position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.45, 12]} />
            <Vinyl color="#3a3a3a" />
          </mesh>
          <Ball color={accent} position={[0, 0.48, 0]} radius={0.11} />
        </group>
      ) : null}
      {character.extra === "horns" ? (
        <>
          {[-1, 1].map((side) => (
            <mesh castShadow key={side} position={[side * 0.38, sy * 0.85, 0.05]} rotation={[0, 0, -side * 0.35]}>
              <coneGeometry args={[0.12, 0.42, 16]} />
              <Vinyl color="#f4ead8" />
            </mesh>
          ))}
        </>
      ) : null}

      <HeadwearPiece
        accent={accent}
        character={character}
        headwear={headwear}
        logo={logo}
        logoPatch={logoPatch}
      />
    </>
  );
}

function Eyes({ character }: { readonly character: Character }) {
  const { kind, color } = character.eyes;
  if (kind === "visor") {
    return (
      <RoundedBox args={[1.05, 0.26, 0.12]} position={[0, 0, 0.02]} radius={0.12} smoothness={4}>
        <Vinyl color={color} emissive />
      </RoundedBox>
    );
  }
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.27, 0, 0]}>
          {kind === "round" ? (
            <>
              <Ball color="#ffffff" position={[0, 0, 0]} radius={0.15} scale={[1, 1, 0.5]} />
              <Ball color={color} position={[0, 0, 0.07]} radius={0.085} scale={[1, 1, 0.5]} />
            </>
          ) : (
            <Ball color={color} position={[0, 0, 0]} radius={0.09} scale={[1, 1.15, 0.5]} />
          )}
          <Ball color="#ffffff" position={[0.03, 0.04, kind === "round" ? 0.11 : 0.045]} radius={0.025} />
        </group>
      ))}
    </>
  );
}

function Muzzle({
  character,
  faceZ,
  mouthRef,
}: {
  readonly character: Character;
  readonly faceZ: number;
  readonly mouthRef: React.RefObject<THREE.Mesh | null>;
}) {
  const { kind, color } = character.muzzle;
  const y = -0.2;
  const mouth = (
    <mesh position={[0, y - 0.14, faceZ + 0.12]} ref={mouthRef} scale={[1, 0.05, 1]}>
      <sphereGeometry args={[0.13, 24, 16]} />
      <meshStandardMaterial color="#3a1010" roughness={0.8} />
    </mesh>
  );
  if (kind === "none") return mouth;
  if (kind === "beak") {
    return (
      <>
        <mesh castShadow position={[0, y, faceZ + 0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.16, 0.36, 20]} />
          <Vinyl color={color} />
        </mesh>
        {mouth}
      </>
    );
  }
  const r = kind === "wide" ? 0.3 : 0.2;
  return (
    <>
      <Ball color={color} position={[0, y, faceZ - 0.1]} radius={r} scale={[1.3, 0.85, 0.75]} />
      <Ball color="#2a1a14" position={[0, y + r * 0.45, faceZ + r * 0.42]} radius={0.075} scale={[1.4, 0.85, 0.8]} />
      {mouth}
    </>
  );
}

function Ears({ character }: { readonly character: Character }) {
  const { kind, color } = character.ears;
  const [sx, sy] = HEAD_SIZE[character.head.shape];
  if (kind === "none") return null;
  return (
    <>
      {[-1, 1].map((side) => {
        if (kind === "round") {
          return <Ball color={color} key={side} position={[side * sx * 0.72, sy * 0.78, 0.08]} radius={0.22} scale={[1, 1, 0.55]} />;
        }
        if (kind === "pointy") {
          return (
            <mesh castShadow key={side} position={[side * sx * 0.62, sy * 0.95, 0]} rotation={[0, 0, -side * 0.28]}>
              <coneGeometry args={[0.24, 0.5, 4]} />
              <Vinyl color={color} />
            </mesh>
          );
        }
        if (kind === "long") {
          return (
            <Capsule
              color={color}
              key={side}
              length={0.7}
              position={[side * 0.26, sy + 0.5, 0]}
              radius={0.13}
              rotation={[0, 0, -side * 0.12]}
            />
          );
        }
        return (
          <Capsule
            color={color}
            key={side}
            length={0.45}
            position={[side * (sx + 0.05), 0.05, 0]}
            radius={0.16}
            rotation={[0, 0, side * 0.25]}
          />
        );
      })}
    </>
  );
}

function Mane({ character }: { readonly character: Character }) {
  const { kind, color } = character.mane;
  const tufts = useMemo(() => {
    if (kind === "none") return [];
    const count = kind === "fluffy" ? 18 : kind === "spiky" ? 12 : 14;
    const ring = kind === "fluffy" ? 0.84 : 0.8;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      // Lion manes run longer at the cheeks and chin than over the crown.
      const reach = kind === "lion" ? ring + 0.08 * Math.max(0, -Math.sin(angle)) : ring;
      return { angle, x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
    });
  }, [kind]);

  if (kind === "none") return null;
  return (
    <group position={[0, 0, -0.18]}>
      <Ball color={color} position={[0, 0, -0.05]} radius={0.82} scale={[1, 1, 0.6]} />
      {tufts.map(({ angle, x, y }) =>
        kind === "spiky" ? (
          <mesh castShadow key={angle} position={[x, y, 0]} rotation={[0, 0, angle - Math.PI / 2]}>
            <coneGeometry args={[0.16, 0.55, 12]} />
            <Vinyl color={color} />
          </mesh>
        ) : (
          <Ball color={color} key={angle} position={[x, y, 0]} radius={kind === "fluffy" ? 0.23 : 0.3} />
        ),
      )}
    </group>
  );
}

function HeadwearPiece({
  headwear,
  character,
  accent,
  logo,
  logoPatch = "#ffffff",
}: {
  readonly headwear: Headwear;
  readonly character: Character;
  readonly accent: string;
  readonly logo?: string;
  readonly logoPatch?: string;
}) {
  const [sx, sy, sz] = HEAD_SIZE[character.head.shape];
  if (headwear === "none") return null;
  if (headwear === "headphones") {
    return (
      <group>
        <mesh castShadow position={[0, 0.12, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[sx + 0.08, 0.06, 12, 40, Math.PI]} />
          <Vinyl color="#111111" />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh castShadow key={side} position={[side * (sx + 0.06), 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.24, 0.24, 0.16, 24]} />
            <Vinyl color={accent} />
          </mesh>
        ))}
      </group>
    );
  }
  const capColor = headwear === "cap" ? accent : "#1a1a1a";
  return (
    <group position={[0, sy * 0.25, 0]}>
      <mesh castShadow scale={[sx * 1.06, sy * 0.95, sz * 1.06]}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Vinyl color={capColor} />
      </mesh>
      {headwear === "cap" ? (
        <mesh castShadow position={[0, 0.0, sz * 0.82]} rotation={[0.28, 0, 0]} scale={[1.15, 1, 0.9]}>
          <cylinderGeometry args={[0.52, 0.52, 0.06, 32, 1, false, -Math.PI / 2, Math.PI]} />
          <Vinyl color={capColor} />
        </mesh>
      ) : null}
      {headwear === "cap" && logo ? (
        <LogoPatch
          patch={logoPatch}
          position={[0, sy * 0.42, sz * 0.93]}
          rotation={[-0.5, 0, 0]}
          size={[0.26, 0.22]}
          url={logo}
        />
      ) : null}
      {headwear === "beanie" ? (
        <>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]} scale={[sx * 1.06, sz * 1.06, 1]}>
            <torusGeometry args={[1, 0.08, 12, 40]} />
            <Vinyl color={accent} />
          </mesh>
          <Ball color={accent} position={[0, sy * 0.95, 0]} radius={0.16} />
          {logo ? (
            <LogoPatch
              patch={logoPatch}
              position={[0, 0.02, sz * 1.06 + 0.07]}
              size={[0.24, 0.2]}
              url={logo}
            />
          ) : null}
        </>
      ) : null}
    </group>
  );
}

/**
 * The team's logo as a sewn-on woven patch. The patch contrasts with the logo,
 * so a logo in the same color as the outfit still reads.
 */
function LogoPatch({
  url,
  patch,
  size,
  position,
  rotation,
}: {
  readonly url: string;
  readonly patch: string;
  readonly size: [number, number];
  readonly position: [number, number, number];
  readonly rotation?: [number, number, number];
}) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const [w, h] = size;
  const art = Math.min(w, h) * 0.82;
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[w, h, 0.03]} radius={0.012} smoothness={3}>
        <meshStandardMaterial color={patch} roughness={0.85} />
      </RoundedBox>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[art, art]} />
        <meshStandardMaterial map={texture} roughness={0.7} transparent />
      </mesh>
    </group>
  );
}

function Torso({ look }: { readonly look: RoaryLook }) {
  const { outfit, outfitColor, accentColor, character, logo, logoPatch = "#ffffff" } = look;
  return (
    <group>
      <RoundedBox args={[1.1, 0.95, 0.74]} castShadow radius={0.3} smoothness={6}>
        <Vinyl color={outfitColor} />
      </RoundedBox>
      {logo ? (
        <>
          {/* Chest patch, and a bigger back print you see when the figure spins. */}
          <LogoPatch patch={logoPatch} position={[0, 0.02, 0.385]} size={[0.32, 0.32]} url={logo} />
          <LogoPatch
            patch={logoPatch}
            position={[0, 0.02, -0.385]}
            rotation={[0, Math.PI, 0]}
            size={[0.46, 0.34]}
            url={logo}
          />
        </>
      ) : null}
      {outfit === "crew" ? (
        <>
          <mesh position={[0, logo ? -0.3 : 0, 0.375]}>
            <boxGeometry args={[0.035, logo ? 0.3 : 0.8, 0.01]} />
            <Vinyl color={accentColor} />
          </mesh>
          <mesh position={[0, 0.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.07, 12, 32]} />
            <Vinyl color={outfitColor} />
          </mesh>
        </>
      ) : null}
      {outfit === "hoodie" ? (
        <>
          <Ball color={outfitColor} position={[0, 0.55, -0.32]} radius={0.42} scale={[1.1, 0.8, 0.7]} />
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (logo ? 0.23 : 0.12), 0.2, 0.38]}>
              <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
              <Vinyl color={accentColor} />
            </mesh>
          ))}
          <RoundedBox args={[0.6, 0.2, 0.05]} position={[0, -0.27, 0.36]} radius={0.06}>
            <Vinyl color={outfitColor} />
          </RoundedBox>
        </>
      ) : null}
      {outfit === "tee" ? (
        <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.28, 0.04, 10, 32]} />
          <Vinyl color={character.body.color} />
        </mesh>
      ) : null}
    </group>
  );
}

function Tail({ character, tailRef }: { readonly character: Character; readonly tailRef: React.RefObject<THREE.Group | null> }) {
  const { kind, color } = character.tail;
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.15, -0.1, -0.35),
        new THREE.Vector3(0.35, 0.2, -0.6),
        new THREE.Vector3(0.45, 0.55, -0.55),
      ]),
    [],
  );
  if (kind === "none") return null;
  return (
    <group position={[0, 0.65, -0.33]} ref={tailRef}>
      {kind === "lion" ? (
        <>
          <mesh castShadow>
            <tubeGeometry args={[curve, 32, 0.06, 10, false]} />
            <Vinyl color={color} />
          </mesh>
          <Ball color={character.mane.kind === "none" ? "#7a4a1c" : character.mane.color} position={[0.45, 0.6, -0.55]} radius={0.14} scale={[1, 1.3, 1]} />
        </>
      ) : kind === "fluffy" ? (
        <Ball color={color} position={[0.1, 0.05, -0.2]} radius={0.3} scale={[0.9, 1.1, 1]} />
      ) : (
        <Ball color={color} position={[0, 0, -0.08]} radius={0.15} />
      )}
    </group>
  );
}

export type Gear = "net" | "wrench" | "clipboard" | "clapper";

/** The tool for Roary's newest job, held in its right hand. */
function GearPiece({ gear, accent }: { readonly gear: Gear; readonly accent: string }) {
  if (gear === "net") {
    return (
      <group position={[0, -0.05, 0.1]} rotation={[0.3, 0, -0.5]}>
        <mesh castShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.8, 10]} />
          <Vinyl color="#8a5a2b" />
        </mesh>
        <mesh castShadow position={[0, 0.85, 0]}>
          <torusGeometry args={[0.2, 0.025, 8, 32]} />
          <Vinyl color={accent} />
        </mesh>
        <mesh position={[0, 0.85, -0.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.19, 0.3, 24, 1, true]} />
          <meshStandardMaterial color="#f4f4f2" opacity={0.7} side={THREE.DoubleSide} transparent />
        </mesh>
      </group>
    );
  }
  if (gear === "wrench") {
    return (
      <group position={[0, 0.1, 0.12]} rotation={[0, 0, -0.6]}>
        <RoundedBox args={[0.1, 0.6, 0.06]} castShadow radius={0.03}>
          <Vinyl color="#c9ced6" />
        </RoundedBox>
        <mesh castShadow position={[0, 0.36, 0]}>
          <torusGeometry args={[0.11, 0.045, 10, 24, Math.PI * 1.5]} />
          <Vinyl color="#c9ced6" />
        </mesh>
        <RoundedBox args={[0.12, 0.2, 0.08]} position={[0, -0.18, 0]} radius={0.03}>
          <Vinyl color={accent} />
        </RoundedBox>
      </group>
    );
  }
  if (gear === "clipboard") {
    return (
      <group position={[0.05, 0.1, 0.18]} rotation={[0.1, -0.3, -0.15]}>
        <RoundedBox args={[0.42, 0.55, 0.04]} castShadow radius={0.02}>
          <Vinyl color="#8a5a2b" />
        </RoundedBox>
        <mesh position={[0, -0.03, 0.025]}>
          <boxGeometry args={[0.34, 0.42, 0.01]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <RoundedBox args={[0.18, 0.06, 0.06]} position={[0, 0.27, 0.03]} radius={0.02}>
          <Vinyl color={accent} />
        </RoundedBox>
      </group>
    );
  }
  return (
    <group position={[0.05, 0.1, 0.18]} rotation={[0, -0.3, -0.1]}>
      <RoundedBox args={[0.5, 0.36, 0.06]} castShadow radius={0.02}>
        <Vinyl color="#111111" />
      </RoundedBox>
      <group position={[-0.25, 0.22, 0]} rotation={[0, 0, 0.35]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[0.05 + i * 0.1, 0, 0]}>
            <boxGeometry args={[0.1, 0.09, 0.065]} />
            <meshStandardMaterial color={i % 2 ? "#ffffff" : "#111111"} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export type FigureCue = { kind: "pop" | "roar"; at: number };

export function RoaryFigure({
  look,
  cue,
  gear,
  energy = 0.5,
}: {
  readonly look: RoaryLook;
  readonly cue?: FigureCue;
  readonly gear?: Gear;
  /** 0 = calm senior, 1 = hype buddy. Scales the idle motion. */
  readonly energy?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const blink = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const tail = useRef<THREE.Group>(null);
  const pop = useRef(0);
  const roar = useRef(0);
  const squash = useRef(0);
  const nextBlink = useRef(2);
  const { character, outfit, outfitColor, accentColor, headwear, logo } = look;
  const sleeves = outfit === "tee" ? character.body.color : outfitColor;

  // Any change to the look or an explicit cue replays the matching reaction.
  useEffect(() => {
    pop.current = 1;
  }, [character, outfit, outfitColor, headwear, logo, gear]);
  useEffect(() => {
    if (!cue) return;
    if (cue.kind === "roar") roar.current = 1;
    else pop.current = 1;
  }, [cue]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const bounce = 0.02 + energy * 0.05;
    if (!root.current || !body.current || !head.current) return;

    pop.current = Math.max(0, pop.current - delta * 1.6);
    roar.current = Math.max(0, roar.current - delta * 0.55);
    squash.current = Math.max(0, squash.current - delta * 3);

    const popCurve = Math.sin(pop.current * Math.PI) * pop.current;
    const roarCurve = Math.sin(Math.min(1, (1 - roar.current) * 1.4) * Math.PI) * (roar.current > 0 ? 1 : 0);

    root.current.position.y = Math.abs(Math.sin(t * (1.2 + energy * 1.6))) * bounce + popCurve * 0.25;
    root.current.rotation.y = pop.current * Math.PI * 2 * pop.current;
    const sq = squash.current * 0.18;
    root.current.scale.set(1 + sq, 1 - sq + roarCurve * 0.08, 1 + sq);
    body.current.scale.y = 1 + Math.sin(t * 2) * 0.015;

    const lookX = state.pointer.x * 0.55;
    const lookY = -state.pointer.y * 0.3 - roarCurve * 0.45;
    head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, lookX, 4, delta);
    head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, lookY, 4, delta);
    head.current.rotation.z = Math.sin(t * 0.9) * 0.03 * (0.5 + energy);

    if (blink.current) {
      if (t > nextBlink.current) nextBlink.current = t + 2.5 + Math.random() * 3;
      const closing = nextBlink.current - t < 0.12 ? 0.1 : 1;
      blink.current.scale.y = THREE.MathUtils.damp(blink.current.scale.y, closing, 30, delta);
    }
    if (mouth.current) {
      mouth.current.scale.y = THREE.MathUtils.damp(mouth.current.scale.y, 0.05 + roarCurve * 1.3, 12, delta);
    }
    if (tail.current) tail.current.rotation.y = Math.sin(t * (1.5 + energy * 2)) * 0.35;
  });

  return (
    <group
      onPointerDown={(event) => {
        event.stopPropagation();
        squash.current = 1;
      }}
      ref={root}
    >
      <group ref={body}>
        {/* Legs and sneakers */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.24, 0, 0]}>
            <Capsule color={character.body.color} length={0.22} position={[0, 0.34, 0]} radius={0.17} />
            <RoundedBox args={[0.36, 0.2, 0.52]} castShadow position={[0, 0.11, 0.06]} radius={0.09} smoothness={4}>
              <Vinyl color="#f4f4f2" />
            </RoundedBox>
            <mesh position={[0, 0.025, 0.06]}>
              <boxGeometry args={[0.37, 0.05, 0.53]} />
              <Vinyl color={accentColor} />
            </mesh>
          </group>
        ))}

        <group position={[0, 0.98, 0]}>
          <Torso look={look} />
        </group>

        {/* Arms */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.66, 1.08, 0]} rotation={[0, 0, side * 0.32]}>
            <Capsule color={sleeves} length={0.42} position={[0, -0.16, 0]} radius={0.15} />
            <Ball color={character.body.color} position={[0, -0.47, 0]} radius={0.15} />
            {side === 1 && gear ? (
              <group position={[0, -0.5, 0.05]} rotation={[0, 0, -0.32]}>
                <GearPiece accent={accentColor} gear={gear} />
              </group>
            ) : null}
          </group>
        ))}

        <Tail character={character} tailRef={tail} />
      </group>

      <group position={[0, 2.02, 0]} ref={head}>
        <Head
          accent={accentColor}
          blinkRef={blink}
          character={character}
          headwear={headwear}
          logo={logo}
          logoPatch={look.logoPatch}
          mouthRef={mouth}
        />
      </group>
    </group>
  );
}
