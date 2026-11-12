import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { randomUUID } from "node:crypto";
import pkg from "./package.json";

// Set NEXT_PUBLIC_BASE_PATH="/<repo-name>" when hosting under a sub-path (GitHub Pages project sites).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Static export: HTML pages aren't webpack assets, so list them for precaching (FR-PW-1 / NFR-3).
const ROUTES = [
  "/",
  "/spools/",
  "/spools/new/",
  "/spools/view/",
  "/spools/edit/",
  "/prints/",
  "/prints/new/",
  "/prints/view/",
  "/prints/edit/",
  "/models/view/",
  "/history/",
  "/settings/",
];
const revision = randomUUID();

const withSerwist = withSerwistInit({
  additionalPrecacheEntries: ROUTES.map((r) => ({ url: `${basePath}${r}`, revision })),
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // Precache everything in public/ (icons, manifest) and every bundled asset, including PGlite's WASM.
  globPublicPatterns: ["**/*"],
  maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
  disable: process.env.NODE_ENV === "development",
  register: false, // registered manually so we can show an "Update available" prompt
});

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        url: false,
        module: false,
      };
    }
    return config;
  },
};

export default withSerwist(nextConfig);
