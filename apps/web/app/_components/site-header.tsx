import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { RoaryMark } from "./roary-mark";

const NAV = [
  { href: "/#jobs", label: "Jobs", wide: true },
  { href: "/#first-day", label: "First day", wide: true },
  { href: "/desk", label: "Desk", wide: false },
] as const;

/** `hideHire` drops the Hire CTA on pages that already are the hiring flow. */
export function SiteHeader({ hideHire = false }: { readonly hideHire?: boolean }) {
  return (
    <header className="border-ink border-b-2 bg-background">
      <div className="mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link aria-label="Roary home" className="rounded-[3px]" href="/">
          <RoaryMark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {NAV.map(({ href, label, wide }) => (
            <Link
              className={`quoted rounded-[3px] px-2.5 py-2 font-mono text-sm uppercase hover:bg-label ${
                wide ? "hidden md:inline-block" : "inline-block"
              }`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
          {hideHire ? null : (
            <Link
              className="plate ml-1 inline-flex items-center gap-2 bg-safety px-4 py-2 font-mono text-sm text-ink uppercase transition-transform hover:-translate-y-px"
              href="/hire"
            >
              Hire Roary
              <ArrowRightIcon className="size-4" />
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
