import type { Metadata } from "next";
import { SiteHeader } from "../_components/site-header";
import { FittingRoom } from "./_components/fitting-room";

export const metadata: Metadata = { title: "Fitting room" };

export default function HirePage() {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <SiteHeader />
      <FittingRoom />
    </div>
  );
}
