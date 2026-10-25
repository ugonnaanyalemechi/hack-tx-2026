/**
 * Runtime settings for the API client, read from environment variables
 * (see web/.env.example). `NEXT_PUBLIC_*` values are inlined at build time.
 */

export type ApiMode = "mock" | "live";

/** Must match the backend's IDENTITY_HEADER_NAME. */
export const IDENTITY_HEADER_NAME =
  process.env.NEXT_PUBLIC_IDENTITY_HEADER_NAME || "X-User-Id";

/**
 * Where the live client sends requests. The default goes through the
 * Next.js rewrite in next.config.ts (`/api/*` -> API_PROXY_TARGET), so the
 * browser never needs CORS.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

const DEFAULT_MODE: ApiMode =
  process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

/**
 * The build's mode, overridable per page load with `?api=live` or
 * `?api=mock` (used by the hermetic Playwright tests of the live client).
 */
export function resolveApiMode(): ApiMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const override = new URLSearchParams(window.location.search).get("api");
  return override === "live" || override === "mock" ? override : DEFAULT_MODE;
}
