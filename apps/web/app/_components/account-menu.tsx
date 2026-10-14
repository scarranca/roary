"use client";

import { UserIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";
import { speciesEmoji } from "@/lib/roary-character";
import { AuthDialog } from "./auth-dialog";

type Hire = { id: number; name: string; species: string; createdAt: string };

const CHIP = "quoted inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-2 font-mono text-sm uppercase hover:bg-label";

/** Header account chip: "Sign in" for guests; for members, "Your Roarys" and sign out. */
export function AccountMenu() {
  const { data: session, isPending } = authClient.useSession();
  const [hires, setHires] = useState<Hire[]>();

  if (isPending) return null;
  const user = session?.user;
  if (!user) {
    return (
      <AuthDialog
        trigger={
          <button className={CHIP} type="button">
            Sign in
          </button>
        }
      />
    );
  }

  const loadHires = async () => {
    try {
      const response = await fetch("/api/profiles/mine");
      const body = (await response.json()) as { profiles?: Hire[] };
      setHires(body.profiles ?? []);
    } catch {
      setHires([]);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && void loadHires()}>
      <DropdownMenuTrigger asChild>
        <button className={CHIP} type="button">
          <UserIcon className="size-4" />
          <span className="hidden max-w-32 truncate sm:inline">{user.name || user.email}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 font-mono">
        <DropdownMenuLabel className="text-muted-foreground text-xs uppercase">Your Roarys</DropdownMenuLabel>
        {hires === undefined ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs uppercase">Loading…</p>
        ) : hires.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs uppercase">None yet. Sign an offer letter.</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto">
            {hires.map((hire) => (
              <li className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm" key={hire.id}>
                <span className="truncate">
                  {speciesEmoji(hire.species)} {hire.name}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">{new Date(hire.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="uppercase">
          <Link href="/settings/connections">Connect your stack</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="truncate px-2 py-1 text-muted-foreground text-xs">{user.email}</p>
        <DropdownMenuItem className="uppercase" onSelect={() => void authClient.signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
