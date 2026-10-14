// End-to-end check of the launch-video path outside eve: Vercel Sandbox render → Blob → Neon.
// npx tsx --env-file=.env.local scripts/launch-video-smoke.ts [content.json] [owner/repo] [prNumber]
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TEMPLATE_FILES,
  renderLaunchVideo,
  saveLaunchVideo,
  uploadLaunchVideo,
  type LaunchVideoContent,
} from "../agent/lib/launch-video";

const templateDir = join(import.meta.dirname, "../agent/sandbox/workspace/video");
const [contentPath = join(templateDir, "content.json"), repo = "scarranca/roary", pr = "31"] = process.argv.slice(2);

const files = await Promise.all(
  TEMPLATE_FILES.map(async (path) => ({ path, content: await readFile(join(templateDir, path)) })),
);
const content = JSON.parse(await readFile(contentPath, "utf8")) as LaunchVideoContent;

console.log("rendering in Vercel Sandbox…");
const { mp4, renderMs, fromSnapshot } = await renderLaunchVideo(files, content);
console.log({ bytes: mp4.length, renderMs, fromSnapshot });

const videoUrl = await uploadLaunchVideo(repo, Number(pr), mp4);
const row = await saveLaunchVideo({ repo, prNumber: Number(pr), title: content.title, videoUrl });
console.log({ videoUrl, launchId: row?.id });
process.exit(0);
