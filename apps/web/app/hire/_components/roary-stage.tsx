"use client";

import { ContactShadows, Environment, Lightformer, PresentationControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { RoaryLook } from "@/lib/roary-character";
import { type FigureCue, type Gear, RoaryFigure } from "./roary-figure";

/** The 3D fitting-room stage: studio light, a turntable, and the figure you can drag to spin. */
export default function RoaryStage({
  look,
  cue,
  gear,
  energy,
}: {
  readonly look: RoaryLook;
  readonly cue?: FigureCue;
  readonly gear?: Gear;
  readonly energy?: number;
}) {
  return (
    <Canvas
      camera={{ fov: 30, position: [0, 1.2, 8.8] }}
      dpr={[1, 1.75]}
      onCreated={({ camera }) => camera.lookAt(0, 0.3, 0)}
      shadows
    >
      <ambientLight intensity={0.55} />
      <directionalLight castShadow intensity={1.5} position={[3, 6, 4]} />
      <directionalLight color="#ffd9c2" intensity={0.6} position={[-4, 2, -3]} />
      {/* Built-in light panels so the vinyl gets studio reflections without fetching an HDR. */}
      <Environment resolution={256}>
        <Lightformer intensity={2} position={[0, 4, 3]} scale={[6, 2, 1]} />
        <Lightformer intensity={1.2} position={[-4, 1, 2]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer color="#ff5a00" intensity={0.6} position={[4, 1, -2]} rotation-y={-Math.PI / 2} scale={[3, 2, 1]} />
      </Environment>

      <PresentationControls
        azimuth={[-Infinity, Infinity]}
        damping={0.25}
        global
        polar={[-0.15, 0.2]}
        snap
      >
        <group position={[0, -1.05, 0]}>
          <Suspense fallback={null}>
            <RoaryFigure cue={cue} energy={energy} gear={gear} look={look} />
          </Suspense>
          <mesh position={[0, -0.05, 0]} receiveShadow>
            <cylinderGeometry args={[1.45, 1.5, 0.1, 64]} />
            <meshStandardMaterial color="#e6e6e6" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[1.48, 0.025, 8, 96]} />
            <meshStandardMaterial color="#ff5a00" />
          </mesh>
        </group>
      </PresentationControls>

      <ContactShadows blur={2.4} far={3} opacity={0.5} position={[0, -1.1, 0]} scale={7} />
    </Canvas>
  );
}
