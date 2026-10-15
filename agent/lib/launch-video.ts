import { put } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";

// Rendering needs Chromium + FFmpeg, which bust the Function bundle limit and can't run in just-bash.
// So we render in a dedicated Vercel Sandbox (Amazon Linux, node22), using the same recipe as
// HeyGen's official hyperframes-vercel-template. Auth comes from VERCEL_OIDC_TOKEN, both locally
// (vercel env pull) and on Vercel.

export const HYPERFRAMES_VERSION = "0.8.158";

/** Template files, relative to agent/sandbox/workspace/video/ (or /workspace/video/ in eve's sandbox). */
export const TEMPLATE_FILES = [
  "index.html",
  "hyperframes.json",
  "meta.json",
  "vendor/gsap.min.js",
  "vendor/inter-latin-wght.woff2",
] as const;

/** Copy slots declared in the template's data-composition-variables. */
export interface LaunchVideoContent {
  product: string;
  title: string;
  tagline: string;
  bullet1: string;
  bullet2: string;
  bullet3: string;
  metricLabel: string;
  metricBefore: string;
  metricAfter: string;
  impact: string;
  authors: string;
  prUrl: string;
}

export interface TemplateFile {
  path: string;
  content: Uint8Array;
}

const RENDER_TIMEOUT_MS = 12 * 60 * 1000;
const RESOURCES = { vcpus: 4 };

async function mustRun(sandbox: Sandbox, label: string, cmd: string, args: string[], sudo = false) {
  const result = await sandbox.runCommand({ cmd, args, sudo });
  if (result.exitCode !== 0) {
    const stderr = (await result.stderr()).slice(-4000);
    const stdout = (await result.stdout()).slice(-2000);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${stderr || stdout}`);
  }
}

/** Installs Chromium system libs, the HyperFrames CLI, FFmpeg and headless Chrome. ~1-2 min. */
export async function prepareRenderSandbox(sandbox: Sandbox): Promise<void> {
  await Promise.all([
    mustRun(
      sandbox,
      "dnf install",
      "dnf",
      [
        "install", "-y", "--setopt=install_weak_deps=False",
        "nss", "nspr", "atk", "at-spi2-atk", "cups-libs", "libdrm", "libxkbcommon",
        "libXcomposite", "libXdamage", "libXext", "libXfixes", "libXrandr", "mesa-libgbm",
        "alsa-lib", "pango",
      ],
      true,
    ),
    mustRun(sandbox, "npm install", "npm", [
      "install", "--no-save", "--no-audit", "--no-fund",
      `hyperframes@${HYPERFRAMES_VERSION}`, "ffmpeg-static", "ffprobe-static",
    ]),
  ]);
  await mustRun(sandbox, "ffmpeg link", "ln", ["-sf", "/vercel/sandbox/node_modules/ffmpeg-static/ffmpeg", "/usr/local/bin/ffmpeg"], true);
  await mustRun(sandbox, "ffprobe link", "ln", ["-sf", "/vercel/sandbox/node_modules/ffprobe-static/bin/linux/x64/ffprobe", "/usr/local/bin/ffprobe"], true);
  await mustRun(sandbox, "browser ensure", "npx", ["--no-install", "hyperframes", "browser", "ensure"]);
}

/** Fresh sandbox with the render toolchain installed. Used for snapshots and as the fallback path. */
export async function createPreparedSandbox(timeout = RENDER_TIMEOUT_MS): Promise<Sandbox> {
  const sandbox = await Sandbox.create({ runtime: "node22", resources: RESOURCES, timeout, persistent: false });
  try {
    await prepareRenderSandbox(sandbox);
    return sandbox;
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
}

async function openRenderSandbox(): Promise<{ sandbox: Sandbox; fromSnapshot: boolean }> {
  const snapshotId = process.env.LAUNCH_VIDEO_SNAPSHOT_ID;
  if (snapshotId) {
    try {
      const sandbox = await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        resources: RESOURCES,
        timeout: RENDER_TIMEOUT_MS,
        persistent: false,
      });
      return { sandbox, fromSnapshot: true };
    } catch (error) {
      console.warn(`[launch-video] snapshot ${snapshotId} unusable, preparing a fresh sandbox:`, error);
    }
  }
  return { sandbox: await createPreparedSandbox(), fromSnapshot: false };
}

/** Renders the template with the given copy and returns the MP4 bytes. */
export async function renderLaunchVideo(
  files: readonly TemplateFile[],
  content: LaunchVideoContent,
): Promise<{ mp4: Buffer; renderMs: number; fromSnapshot: boolean }> {
  const startedAt = Date.now();
  const { sandbox, fromSnapshot } = await openRenderSandbox();
  try {
    await sandbox.writeFiles([
      ...files.map((file) => ({ path: `video/${file.path}`, content: file.content })),
      { path: "video/content.json", content: JSON.stringify(content, null, 2) },
    ]);
    await mustRun(sandbox, "hyperframes render", "npx", [
      "--no-install", "hyperframes", "render", "video",
      "--variables-file", "video/content.json",
      "--strict-variables",
      "--quality", "draft",
      "--workers", "auto",
      "--output", "launch.mp4",
    ]);
    const mp4 = await sandbox.readFileToBuffer({ path: "launch.mp4" });
    if (!mp4) throw new Error("hyperframes render finished but launch.mp4 is missing");
    return { mp4, renderMs: Date.now() - startedAt, fromSnapshot };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

/** Uploads the MP4 to Vercel Blob (public) and returns its URL. */
export async function uploadLaunchVideo(repo: string, prNumber: number, mp4: Buffer): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set. Connect the roary-videos Blob store and run `vercel env pull`.");
  }
  const blob = await put(`launch-videos/${repo.replace("/", "-")}-pr-${prNumber}.mp4`, mp4, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: true,
  });
  return blob.url;
}

/** Points the launch row for this PR at the video, creating the row if needed. */
export async function saveLaunchVideo(input: {
  repo: string;
  prNumber: number;
  title: string;
  videoUrl: string;
  workspaceId: number;
}) {
  const { launches } = schema;
  // No unique index on (repo, prNumber), so select-then-write instead of an upsert.
  const [existing] = await db
    .select({ id: launches.id })
    .from(launches)
    .where(
      and(
        eq(launches.workspaceId, input.workspaceId),
        eq(launches.repo, input.repo),
        eq(launches.prNumber, input.prNumber),
      ),
    )
    .orderBy(desc(launches.createdAt))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(launches)
      .set({ videoUrl: input.videoUrl, title: input.title })
      .where(eq(launches.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(launches).values(input).returning();
  return row;
}
