import { GITHUB_CONNECTOR, type Validation } from "./validate";

// Proof that the signed-in person can actually reach a GitHub App installation before it is
// bound to their workspace. GitHub's install redirect carries `installation_id` in the query
// string, which anyone can type, so the id alone proves nothing. We get a GitHub *user* token for
// this Neon Auth user through Vercel Connect (github/roary, user subject) and require the id to be
// in GET /user/installations, which lists only installations that user can access.
//
// Off unless GITHUB_CONNECT_ENABLED=1: the round trip needs the myroary App's Setup URL pointed at
// /api/connect/github/callback and a person to finish GitHub's OAuth screen, which hasn't been
// verified end to end yet. Sentry and PostHog don't depend on it.

export function githubConnectEnabled(): boolean {
  return process.env.GITHUB_CONNECT_ENABLED === "1";
}

const TIMEOUT_MS = 10_000;

/** The Connect user subject for a Neon Auth user: the id is the Neon user id, scoped to its issuer. */
export function githubUserSubject(userId: string) {
  const base = process.env.NEON_AUTH_BASE_URL;
  return { type: "user" as const, id: userId, ...(base ? { issuer: new URL(base).origin } : {}) };
}

export type UserToken = { kind: "token"; token: string } | { kind: "authorize"; url: string };

/**
 * The person's GitHub user token, or the Connect authorize URL to send them to first. After
 * GitHub's OAuth screen, Connect redirects back to `returnTo` and the next call has a token.
 */
export async function githubUserToken(userId: string, returnTo: string): Promise<UserToken> {
  const { getToken, startAuthorization } = await import("@vercel/connect");
  const subject = githubUserSubject(userId);
  try {
    return { kind: "token", token: await getToken(GITHUB_CONNECTOR, { subject }) };
  } catch (error) {
    const { name, status } = error as { name?: string; status?: number };
    if (name !== "UserAuthorizationRequiredError" && status !== 401) throw error;
  }
  const { url } = await startAuthorization(GITHUB_CONNECTOR, { subject }, { callbackUrl: returnTo });
  return { kind: "authorize", url };
}

/** Is `installationId` one of the installations this GitHub user token can access? */
export async function userCanAccessInstallation(
  userToken: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Validation<{ installationId: string }>> {
  if (!/^\d{1,12}$/.test(installationId)) return { ok: false, code: "bad_input", message: "That isn't a GitHub installation id." };
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await fetchImpl(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${userToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status === 401) return { ok: false, code: "user_token_invalid", message: "GitHub didn't accept your sign-in. Try again." };
      if (!response.ok) return { ok: false, code: `http_${response.status}`, message: `GitHub answered ${response.status}.` };
      const body = (await response.json()) as { total_count?: number; installations?: { id: number }[] };
      const installations = body.installations ?? [];
      if (installations.some((i) => String(i.id) === installationId)) {
        return { ok: true, checkedVia: "user-installations", detail: { installationId } };
      }
      if (installations.length < 100) break;
    }
    return { ok: false, code: "not_your_installation", message: "Your GitHub account can't access that installation." };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, code: "unreachable", message: `GitHub didn't answer${timedOut ? " in time" : ""}. Try again.` };
  }
}
