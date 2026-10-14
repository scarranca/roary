import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../_components/site-header";

export const metadata: Metadata = { title: "Fitting room" };

// Placeholder until the fitting room (#14) lands.
export default function HirePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="ripstop grid flex-1 place-items-center px-4 py-20 text-cotton">
        <div className="flex max-w-xl flex-col items-center gap-6 text-center">
          <h1 className="quoted type-display text-6xl sm:text-7xl">Fitting room</h1>
          <p className="font-mono uppercase">Build your Roary here: character, swag, personality, jobs.</p>
          <Link className="plate bg-safety px-5 py-3 font-mono text-ink uppercase" href="/desk">
            Talk to Roary meanwhile
          </Link>
        </div>
      </main>
    </div>
  );
}
