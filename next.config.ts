import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Permite uploads de migrations (zip/pasta) até 50MB sem truncamento pelo proxy interno.
    proxyClientMaxBodySize: 50 * 1024 * 1024,
  },
};

export default nextConfig;
