import type { NextConfig } from "next";

/**
 * NEXT_PUBLIC_API_URL — set this in frontend/.env (or Vercel env vars) to your
 * deployed backend URL, e.g. https://autopilot-backend.onrender.com
 *
 * In development it defaults to http://localhost:3001 automatically.
 */
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Proxy all /api/* calls from the frontend → the Fastify backend
        // Works both in development (localhost:3001) and production (Render URL)
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
