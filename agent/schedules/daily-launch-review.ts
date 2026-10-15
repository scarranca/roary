import { defineSchedule } from "eve/schedules";
import { runDailyLaunchReview } from "../lib/daily-launch-review";

// Daily launch review at 15:00 UTC (morning in the Americas, afternoon in Europe). Stores one
// `launches` row per change for every workspace with connections; posts nothing unless the
// workspace opted in. See agent/lib/daily-launch-review.ts.
export default defineSchedule({
  cron: "0 15 * * *",
  async run({ waitUntil }) {
    waitUntil(runDailyLaunchReview());
  },
});
