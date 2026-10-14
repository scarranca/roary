import { defineTool } from "eve/tools";
import { z } from "zod";
import { toJson } from "../lib/db";
import {
  TEMPLATE_FILES,
  renderLaunchVideo,
  saveLaunchVideo,
  uploadLaunchVideo,
} from "../lib/launch-video";

const line = (max: number, what: string) => z.string().min(1).max(max).describe(what);

export default defineTool({
  description:
    "Render Roary's branded ~20s launch video for a merged feature PR, upload it to Vercel Blob and record it on the launch. Call it once per PR, after you have read the PR and written the copy (follow the launch-video skill). Rendering takes a few minutes. Returns a public MP4 URL to post on the PR.",
  inputSchema: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe("Repository as owner/name"),
    prNumber: z.number().int().positive().describe("Merged pull request number"),
    product: line(40, "Product or repo name shown in the intro, e.g. 'acme/checkout'"),
    title: line(48, "Feature name, 2-5 words, e.g. 'One-tap checkout'"),
    tagline: line(110, "One sentence on what the feature does for users"),
    bullets: z
      .array(line(60, "One highlight"))
      .length(3)
      .describe("Exactly three short highlights, each under 60 characters, user-facing benefits first"),
    metricLabel: line(40, "What the before/after numbers measure, e.g. 'Time to pay'"),
    metricBefore: line(10, "Value before the change, e.g. '48s'. Use a real number from the PR when there is one"),
    metricAfter: line(10, "Value after the change, e.g. '9s'"),
    impact: line(70, "One line on user impact, e.g. '5x faster checkout for every shopper'"),
    authors: z.array(z.string().min(1)).min(1).max(6).describe("GitHub handles of the people who shipped it, without @"),
  }),
  async execute(input, ctx) {
    // The template is seeded into eve's sandbox at /workspace/video (agent/sandbox/workspace/video).
    const workspace = await ctx.getSandbox();
    const files = await Promise.all(
      TEMPLATE_FILES.map(async (path) => ({
        path,
        content: await workspace.readBinaryFile({ path: `/workspace/video/${path}` }),
      })),
    );
    const missing = files.filter((file) => !file.content).map((file) => file.path);
    if (missing.length) throw new Error(`Launch video template files missing in /workspace/video: ${missing.join(", ")}`);

    const [bullet1, bullet2, bullet3] = input.bullets;
    const { mp4, renderMs, fromSnapshot } = await renderLaunchVideo(
      files.map((file) => ({ path: file.path, content: file.content! })),
      {
        product: input.product,
        title: input.title,
        tagline: input.tagline,
        bullet1,
        bullet2,
        bullet3,
        metricLabel: input.metricLabel,
        metricBefore: input.metricBefore,
        metricAfter: input.metricAfter,
        impact: input.impact,
        authors: input.authors.map((handle) => `@${handle.replace(/^@/, "")}`).join(", "),
        prUrl: `github.com/${input.repo}/pull/${input.prNumber}`,
      },
    );
    const videoUrl = await uploadLaunchVideo(input.repo, input.prNumber, mp4);
    const launch = await saveLaunchVideo({ repo: input.repo, prNumber: input.prNumber, title: input.title, videoUrl });
    return toJson({ videoUrl, launchId: launch?.id ?? null, renderSeconds: Math.round(renderMs / 1000), fromSnapshot });
  },
});
