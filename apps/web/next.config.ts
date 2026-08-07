import type { NextConfig } from "next";

const apiDestination = process.env.API_PROXY_TARGET || "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  experimental: {
    useTypeScriptCli: false,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiDestination}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
