import type { GithubConfig, PosthogConfig, SentryConfig } from "./types";

// Live checks that a pasted credential can do what Roary needs, before anything is
// stored. No Next imports, so scripts/ can run these directly. Never echo secrets.

export type Validation<D = Record<string, unknown>> =
  | { ok: true; checkedVia: string; detail: D }
  | { ok: false; code: string; message: string };

const TIMEOUT_MS = 10_000;
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const POSTHOG_HOSTS = { us: "https://us.posthog.com", eu: "https://eu.posthog.com" } as const;
export type PosthogRegion = keyof typeof POSTHOG_HOSTS;

async function call(url: string, token: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

function unreachable(service: string, error: unknown): Validation<never> {
  const timedOut = error instanceof Error && error.name === "TimeoutError";
  return { ok: false, code: "unreachable", message: `${service} didn't answer${timedOut ? " in time" : ""}. Try again.` };
}

/**
 * Sentry: GET /projects/{org}/{project}/ (needs project:read). Tokens that only carry
 * event:read (Roary's own internal integration) get 403 there, so fall back to the
 * project's issues, which is exactly what triage reads.
 */
export async function validateSentry(
  token: string,
  { org, project }: SentryConfig,
): Promise<Validation<{ project: string; name?: string }>> {
  if (!SLUG.test(org) || !SLUG.test(project)) return { ok: false, code: "bad_input", message: "Org and project are slugs, like acme and web-app." };
  const base = `https://sentry.io/api/0/projects/${org}/${project}`;
  try {
    const details = await call(`${base}/`, token);
    if (details.ok) {
      const body = (await details.json()) as { slug?: string; name?: string };
      return { ok: true, checkedVia: "project", detail: { project: body.slug ?? project, name: body.name } };
    }
    if (details.status === 401) return { ok: false, code: "unauthorized", message: "Sentry rejected that token." };
    if (details.status === 404) return { ok: false, code: "not_found", message: `No Sentry project ${org}/${project} for this token.` };
    if (details.status !== 403) return { ok: false, code: `http_${details.status}`, message: `Sentry answered ${details.status}.` };

    const issues = await call(`${base}/issues/?limit=1`, token);
    if (issues.ok) return { ok: true, checkedVia: "issues", detail: { project } };
    if (issues.status === 404) return { ok: false, code: "not_found", message: `No Sentry project ${org}/${project} for this token.` };
    return {
      ok: false,
      code: "forbidden",
      message: "That token can't read this project. Give it Project: Read and Issue & Event: Read.",
    };
  } catch (error) {
    return unreachable("Sentry", error);
  }
}

/** Sentry App install (org-wide token): GET /organizations/{org}/issues/?limit=1, the read triage needs. */
export async function validateSentryOrg(token: string, org: string): Promise<Validation<{ org: string }>> {
  if (!SLUG.test(org)) return { ok: false, code: "bad_input", message: "The Sentry org slug looks wrong." };
  try {
    const response = await call(`https://sentry.io/api/0/organizations/${org}/issues/?limit=1`, token);
    if (response.ok) return { ok: true, checkedVia: "org-issues", detail: { org } };
    if (response.status === 401) return { ok: false, code: "unauthorized", message: "Sentry rejected Roary's token. Install it again." };
    return { ok: false, code: `http_${response.status}`, message: `Sentry answered ${response.status}.` };
  } catch (error) {
    return unreachable("Sentry", error);
  }
}

/** PostHog: GET {host}/api/projects/{id}/ with the personal API key. A wrong region answers 401. */
export async function validatePosthog(
  apiKey: string,
  { projectId, host }: PosthogConfig,
): Promise<Validation<{ projectId: string; name?: string }>> {
  if (!/^\d{1,12}$/.test(projectId)) return { ok: false, code: "bad_input", message: "The project id is a number, like 12345." };
  if (!Object.values(POSTHOG_HOSTS).includes(host as (typeof POSTHOG_HOSTS)[PosthogRegion])) {
    return { ok: false, code: "bad_input", message: "Pick US or EU cloud." };
  }
  try {
    const response = await call(`${host}/api/projects/${projectId}/`, apiKey);
    if (response.ok) {
      const body = (await response.json()) as { id?: number; name?: string };
      return { ok: true, checkedVia: "project", detail: { projectId: String(body.id ?? projectId), name: body.name } };
    }
    if (response.status === 401) {
      return { ok: false, code: "unauthorized", message: "PostHog rejected that key. Check it's a personal API key and the region (US or EU)." };
    }
    if (response.status === 403) return { ok: false, code: "forbidden", message: "That key can't read this project. Give it project:read." };
    if (response.status === 404) return { ok: false, code: "not_found", message: `No PostHog project ${projectId} for this key.` };
    return { ok: false, code: `http_${response.status}`, message: `PostHog answered ${response.status}.` };
  } catch (error) {
    return unreachable("PostHog", error);
  }
}

export const GITHUB_CONNECTOR = process.env.GITHUB_CONNECTOR ?? "github/roary";
export const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "myroary";

/**
 * GitHub: Vercel Connect holds the myroary App's private key, so instead of signing an
 * app JWT we ask it for an installation token. GitHub refuses (Connect answers 422) when
 * the installation doesn't belong to this App, so a minted token is the proof it exists.
 */
export async function verifyGithubInstallation(installationId: string): Promise<Validation<GithubConfig & { total: number }>> {
  if (!/^\d{1,12}$/.test(installationId)) return { ok: false, code: "bad_input", message: "That isn't a GitHub installation id." };
  let token: string;
  try {
    const { getTokenResponse } = await import("@vercel/connect");
    ({ token } = await getTokenResponse(GITHUB_CONNECTOR, { subject: { type: "app" }, installationId }));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 422 || status === 404) {
      return { ok: false, code: "not_installed", message: `Installation ${installationId} isn't an install of ${GITHUB_APP_SLUG}.` };
    }
    console.error("connect github token failed", (error as Error).name, status);
    return { ok: false, code: "connect_unavailable", message: "Couldn't reach Vercel Connect for a GitHub token." };
  }
  try {
    const repos: string[] = [];
    let total = 0;
    // Up to 1,000 repos; "All repositories" installs on huge orgs stay usable, just listed partially.
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) return { ok: false, code: `http_${response.status}`, message: `GitHub answered ${response.status}.` };
      const body = (await response.json()) as { total_count: number; repositories: { full_name: string }[] };
      total = body.total_count;
      repos.push(...body.repositories.map((r) => r.full_name));
      if (repos.length >= total || body.repositories.length === 0) break;
    }
    return { ok: true, checkedVia: "connect-installation-token", detail: { installationId, repos, total } };
  } catch (error) {
    return unreachable("GitHub", error);
  }
}
