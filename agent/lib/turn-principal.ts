import { defineState } from "eve/context";
import type { Principal } from "./workspace";

type StoredPrincipal = {
  authenticator: string;
  principalType: string;
  principalId: string;
  attributes: Record<string, string | string[]>;
};

/**
 * Who the current turn runs for, recorded by agent/hooks/turn-principal.ts on `turn.started`.
 * The GitHub tools' token provider (agent/extensions/github.ts) gets no tool context, only the
 * call, so it reads the workspace from here. Durable per-session state, never a secret: just
 * the principal that resolveWorkspace() already routes on.
 */
export const turnPrincipal = defineState<StoredPrincipal | null>("roary.turn-principal", () => null);

/** A plain, serializable copy (eve's auth context may carry readonly arrays and extra fields). */
export function storablePrincipal(principal: Principal): StoredPrincipal | null {
  if (!principal) return null;
  const attributes: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(principal.attributes ?? {})) {
    if (typeof value === "string") attributes[key] = value;
    else if (Array.isArray(value)) attributes[key] = value.filter((v): v is string => typeof v === "string");
  }
  return { authenticator: principal.authenticator, principalType: principal.principalType, principalId: principal.principalId, attributes };
}
