import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only SDKs are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["braintree"],
};

export default nextConfig;
