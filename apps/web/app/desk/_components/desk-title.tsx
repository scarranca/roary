"use client";

import { useHiredRoary } from "@/lib/hired-roary-store";

/** "<Name>'s desk" once a Roary has been hired in this browser. */
export function DeskTitle() {
  const hired = useHiredRoary();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="quoted type-display text-6xl sm:text-7xl" id="feed-title">
        {hired ? `${hired.name}'s desk` : "Roary's desk"}
      </h1>
      <p className="font-mono text-sm uppercase">
        {hired
          ? `Your ${hired.look.character.species}, hired ${new Date(hired.hiredAt).toLocaleDateString()} · on shift`
          : "What Roary is looking at right now"}
      </p>
    </div>
  );
}
