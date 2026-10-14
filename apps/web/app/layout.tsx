import type { Metadata } from "next";
import { Archivo, Share_Tech_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const mono = Share_Tech_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Hire Roary", template: "%s · Roary" },
  description:
    "Roary is the AI teammate you hire: it triages errors, opens fix PRs, reviews launches and makes launch videos.",
};

const DIRECTION_CONTRACT = `<!--
THESIS: Hiring Roary is issuing a crew jacket, not configuring a dashboard; refuses the hero + feature-card grid.
OWN-WORLD: White cotton and black nylon, safety-orange zip-tie tags, 45deg hazard stripes, square label plates with corner screws, quoted condensed caps, Share Tech Mono labels.
STORY: Visitors learn Roary is an AI engineer with a job description, see its first day, trust that humans merge, then sign the offer letter.
FIRST VIEWPORT: Left, a quoted 6rem headline, one mono line and the orange HIRE ROARY plate; right, Roary's black nylon jacket panel with a clipped ID badge and a swinging NEW HIRE tag.
FORM: Industrial streetwear quote grammar, challenger chosen by the user; seed 91864faa.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html className={cn(sans.variable, mono.variable)} lang="en">
      <body>
        <div dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} hidden />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
