import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No dev badge: it covers the stage controls during on-screen demos.
  devIndicators: false,
  async headers() {
    return [
      {
        // A leftover `__vdpl` skew cookie pins the browser's fetches (/api/feed,
        // /api/profiles, eve chat) to an old deployment: the page renders the new
        // build, but the feed 404s and chat 401s with "placeholderAuth()". Nothing
        // in this build sets that cookie, so expire it whenever a browser sends it.
        source: "/:path*",
        has: [{ type: "cookie", key: "__vdpl" }],
        headers: [{ key: "Set-Cookie", value: "__vdpl=; Path=/; HttpOnly; Max-Age=0" }],
      },
    ];
  },
};

export default nextConfig;
