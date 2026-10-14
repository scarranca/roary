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
