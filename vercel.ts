import { withEve } from "eve/vercel";

export default await withEve({
  services: {
    web: {
      framework: "nextjs",
      root: "apps/web",
      buildCommand: "node ../../node_modules/next/dist/bin/next build",
    },
  },
  routes: [
    // Custom eve channel endpoints aren't published automatically; route them to the agent service.
    { src: "^/sentry/webhook$", destination: { type: "service", service: "eve" } },
    { src: "^(.*)$", destination: { type: "service", service: "web" } },
  ],
});
