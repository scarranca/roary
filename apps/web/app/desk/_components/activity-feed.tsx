import { cn } from "@/lib/utils";

type Status = "investigating" | "diagnosed" | "fix_proposed" | "resolved" | "shipped";

// Sample rows until #18 reads incidents and launches from Neon.
const SAMPLE_ITEMS: { id: string; kind: "Incident" | "Launch"; title: string; detail: string; status: Status }[] = [
  {
    id: "ROARY-12",
    kind: "Incident",
    title: "Checkout crash",
    detail: "single-item carts · lines[1] is undefined · suspect 8d41418",
    status: "diagnosed",
  },
  {
    id: "ROARY-9",
    kind: "Incident",
    title: "Slow search on /products",
    detail: "Fix PR #41 open",
    status: "fix_proposed",
  },
  {
    id: "PR-37",
    kind: "Launch",
    title: "Dark mode",
    detail: "Launch video ready · errors flat",
    status: "shipped",
  },
];

const STATUS_STYLES: Record<Status, { label: string; className: string }> = {
  investigating: { label: "Investigating", className: "bg-label" },
  diagnosed: { label: "Diagnosed", className: "bg-wait-soft" },
  fix_proposed: { label: "Fix proposed", className: "bg-safety" },
  resolved: { label: "Resolved", className: "bg-ok-soft" },
  shipped: { label: "Shipped", className: "bg-ok-soft" },
};

export function ActivityFeed() {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col border-ink border-t-2">
        {SAMPLE_ITEMS.map((item) => {
          const status = STATUS_STYLES[item.status];
          return (
            <li className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 border-ink border-b-2 py-4" key={item.id}>
              <p className="font-mono text-muted-foreground text-xs uppercase">
                {item.kind} · {item.id}
              </p>
              <span
                className={cn(
                  "quoted row-span-3 self-center whitespace-nowrap rounded-[3px] border-2 border-ink px-2.5 py-1 font-mono text-ink text-xs uppercase",
                  status.className,
                )}
              >
                {status.label}
              </span>
              <h3 className="type-display text-3xl">{item.title}</h3>
              <p className="font-mono text-sm uppercase">{item.detail}</p>
            </li>
          );
        })}
      </ul>
      <p className="w-fit border-2 border-ink px-2 py-1 font-mono text-xs uppercase">
        Sample data · the live feed comes in #18
      </p>
    </div>
  );
}
