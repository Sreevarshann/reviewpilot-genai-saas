import type { NextConfig } from "next";

const API_ORIGIN = process.env.REVIEWPILOT_API_ORIGIN ?? "http://127.0.0.1:8113";

// The API is proxied under the same origin so the session cookie stays first-party
// (SameSite=Lax, HttpOnly) and the backend's Origin check sees http://localhost:3103.
const nextConfig: NextConfig = {
  cacheComponents: true,
  agentRules: false,
  // separate build output lets the E2E production build run beside `next dev`
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
};

export default nextConfig;
