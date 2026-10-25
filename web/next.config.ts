import type { NextConfig } from "next";

// The browser calls the platform API at relative /v1/* paths and Next
// proxies them to the FastAPI backend, so the backend needs no CORS setup.
// Playwright fakes /v1/* inside the browser, so tests never reach it.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${apiBaseUrl}/v1/:path*` }];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
