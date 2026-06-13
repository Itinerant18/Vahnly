import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// Enabled only when ANALYZE=true (set by `npm run analyze`). The analyzer hooks the
// Webpack build, so the analyze script builds with --webpack; the default `next build`
// keeps using Turbopack.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withBundleAnalyzer(nextConfig);
