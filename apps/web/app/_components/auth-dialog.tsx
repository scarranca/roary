"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { authClient } from "@/lib/auth/client";

type Mode = "sign-in" | "sign-up";

const FIELD =
  "rounded-[3px] border-2 border-ink bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:outline-2 focus-visible:outline-safety";

/**
 * Email + password sign-in / sign-up (Neon Auth) in a dialog, so the fitting room
 * keeps its state: nothing navigates away. `trigger` is the element that opens it.
 */
export function AuthDialog({ trigger, initialMode = "sign-in" }: { readonly trigger: ReactNode; readonly initialMode?: Mode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { refetch } = authClient.useSession();
  const ids = { name: useId(), email: useId(), password: useId() };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(undefined);
    try {
      const { error: authError } =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() || email.split("@")[0] })
          : await authClient.signIn.email({ email, password });
      if (authError) {
        setError(authError.message || (mode === "sign-up" ? "Couldn't create that account." : "Wrong email or password."));
        return;
      }
      await refetch();
      setOpen(false);
    } catch {
      setError("Sign-in is unavailable right now. You can keep going as a guest.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMode(initialMode);
          setError(undefined);
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="plate gap-5 rounded-[3px] border-2 border-ink bg-background">
        <div className="flex flex-col gap-1">
          <DialogTitle className="font-mono text-lg uppercase">{mode === "sign-up" ? "Create your account" : "Sign in"}</DialogTitle>
          <DialogDescription className="font-mono text-muted-foreground text-xs uppercase">
            Your hires stay on your account. Guests can still hire, the Roary just lives in this browser.
          </DialogDescription>
        </div>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          {mode === "sign-up" ? (
            <>
              <label className="font-mono text-muted-foreground text-xs uppercase" htmlFor={ids.name}>
                Name
              </label>
              <input autoComplete="name" className={FIELD} id={ids.name} name="name" />
            </>
          ) : null}
          <label className="font-mono text-muted-foreground text-xs uppercase" htmlFor={ids.email}>
            Email
          </label>
          <input autoComplete="email" className={FIELD} id={ids.email} name="email" required type="email" />
          <label className="font-mono text-muted-foreground text-xs uppercase" htmlFor={ids.password}>
            Password
          </label>
          <input
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            className={FIELD}
            id={ids.password}
            minLength={8}
            name="password"
            required
            type="password"
          />
          {error ? (
            <p className="font-mono text-destructive text-xs uppercase" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="plate mt-2 inline-flex items-center justify-center bg-safety px-5 py-3 font-mono text-ink uppercase transition-transform hover:-translate-y-px disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "One sec…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          className="font-mono text-xs uppercase underline"
          onClick={() => {
            setMode(mode === "sign-up" ? "sign-in" : "sign-up");
            setError(undefined);
          }}
          type="button"
        >
          {mode === "sign-up" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
