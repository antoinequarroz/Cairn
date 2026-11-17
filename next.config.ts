import type { NextConfig } from "next";

// What the pages may load. Notes show images and videos from anywhere (Markdown), but scripts, fetches
// and forms stay on Cairn: if text in a note ever got past the sanitizer, it could not send the
// unlocked vault elsewhere with fetch(), nor load a script from another site. 'unsafe-inline' is
// needed by Next.js for its own inline scripts; 'wasm-unsafe-eval' by Argon2id (hash-wasm).
// Production only: the dev server needs eval for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Cairn holds secrets: never inside someone else's page, never leaking its URLs.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
