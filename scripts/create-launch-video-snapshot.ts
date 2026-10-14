// Bakes the render toolchain into a Vercel Sandbox snapshot so launch videos skip the ~1-2 min setup.
// npx tsx --env-file=.env.local scripts/create-launch-video-snapshot.ts
// Then: set LAUNCH_VIDEO_SNAPSHOT_ID in the Vercel project (all environments) and in .env.local.
import { createPreparedSandbox } from "../agent/lib/launch-video";

const sandbox = await createPreparedSandbox(20 * 60 * 1000);
const snapshot = await sandbox.snapshot({ expiration: 0 }); // stops the sandbox; 0 = never expires
console.log(`LAUNCH_VIDEO_SNAPSHOT_ID=${snapshot.snapshotId}`);
process.exit(0);
