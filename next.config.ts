import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "canvas", "tesseract.js", "pdfjs-dist"],
};

export default nextConfig;
