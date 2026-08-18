import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production-optimized self-contained build for the Docker image.
  output: "standalone",
  // The pg driver (node-postgres) should stay as a runtime dependency,
  // not be bundled, to avoid issues with its optional native bindings.
  // pg + nodemailer should stay as runtime dependencies, not be bundled.
    serverExternalPackages: ["pg", "nodemailer"],
  webpack: (config) => {
    if (process.env.NODE_ENV === "development") {
      config.module.rules.push({
        test: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
        enforce: "pre",
        use: "@dyad-sh/nextjs-webpack-component-tagger",
      });
    }
    return config;
  },
};

export default nextConfig;
