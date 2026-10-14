import { cn } from "@/lib/utils";

/** Roary's name plate: quoted condensed caps on a screwed-down label. */
export function RoaryMark({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "plate inline-flex items-center bg-card px-3.5 py-1.5 type-display text-[1.6rem] leading-none",
        className,
      )}
    >
      <span className="quoted">Roary</span>
    </span>
  );
}
