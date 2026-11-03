import type { NextConfig } from "next";

/**
 * Phase 6D (F-22): security headers now apply to ALL routes — previously the
 * middleware only guarded /api/*, leaving HTML pages frameable and unfenced
 * against content-type/confused-deputy attacks. HSTS remains conditional on
 * HTTPS in the middleware for API routes; the static headers below are safe
 * for both HTTP (dev) and HTTPS (prod) traffic.
 *
 * CSP is deliberately conservative for a Next.js App Router app: inline
 * scripts/styles are required by Next.js hydration and Tailwind, so
 * 'unsafe-inline' is scoped to script-src/style-src while default-src locks
 * down every other fetch/connect/frame direction. img-src allows https +
 * data URIs because event media/avatar images are external URLs (validated
 * to http(s) schemes by the Phase 6D F-7 safe-URL validators).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['preview-chat-4b770969-223b-4bfb-86be-1e2fc008a045.space-z.ai'],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
