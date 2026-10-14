import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Safety-orange PVC tag. It hangs from the punched hole on its left edge;
 * `rest` is the angle it settles at, and `swing` replays the one-time swing.
 */
export function ZipTag({
  children,
  className,
  rest = 0,
  swing = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly rest?: number;
  readonly swing?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex flex-col justify-center gap-1 bg-safety py-2 pr-3 pl-7 font-mono text-[11px] text-ink uppercase leading-tight shadow-[0_6px_14px_-6px_rgb(10_10_10/0.45)]",
        "[clip-path:polygon(14px_0,100%_0,100%_100%,14px_100%,0_50%)]",
        "[mask:radial-gradient(circle_at_13px_50%,transparent_4px,#000_4.5px)]",
        swing && "swing",
        className,
      )}
      style={
        {
          "--hang-x": "13px",
          "--hang-y": "50%",
          "--swing-rest": `${rest}deg`,
          "--swing-from": `${rest + 22}deg`,
          rotate: `${rest}deg`,
        } as CSSProperties
      }
    >
      {children}
      <span aria-hidden className="barcode mt-0.5 block h-3 w-16 opacity-90" />
    </span>
  );
}
