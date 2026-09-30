import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['preview-chat-4b770969-223b-4bfb-86be-1e2fc008a045.space-z.ai'],
};

export default nextConfig;
