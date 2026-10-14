"use client";

import { useEffect, useState } from "react";
import type { HiredRoary } from "./roary-character";

// The hire lives in this browser until profiles are saved to Neon (#15).
const KEY = "roary:hired";

export function saveHiredRoary(hired: HiredRoary) {
  try {
    localStorage.setItem(KEY, JSON.stringify(hired));
    return true;
  } catch {
    // Storage full or blocked: the desk falls back to the default Roary.
    return false;
  }
}

/**
 * Saves the hire to Neon in the background; the local copy keeps working if this
 * fails (no network, no database). Images are not sent.
 */
export async function persistHiredRoary(hired: HiredRoary) {
  const { logo: _logo, ...look } = hired.look;
  try {
    const response = await fetch("/api/profiles", {
      body: JSON.stringify({ name: hired.name, look, personality: hired.personality, jobs: hired.jobs, autonomy: hired.autonomy }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return;
    const { id } = (await response.json()) as { id?: number };
    if (typeof id === "number") saveHiredRoary({ ...hired, profileId: id });
  } catch {
    // Offline or blocked: the browser copy is enough for the desk.
  }
}

function readHiredRoary(): HiredRoary | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HiredRoary) : undefined;
  } catch {
    return undefined;
  }
}

/** The Roary this browser hired, or undefined before the first hire (and during SSR). */
export function useHiredRoary() {
  const [hired, setHired] = useState<HiredRoary>();
  useEffect(() => {
    setHired(readHiredRoary());
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setHired(readHiredRoary());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return hired;
}
