import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pages dynamic where they read the DB; no static caching of the demo.
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
