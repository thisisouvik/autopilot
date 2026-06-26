/**
 * Prisma client using the Neon serverless HTTP driver.
 *
 * @neondatabase/serverless can operate in two modes:
 *  1. WebSocket (Pool) — still uses TCP port 5432, suffers from IPv4/IPv6 issues
 *  2. HTTP (neon tagged SQL) — connects over HTTPS port 443, works everywhere
 *
 * We use mode 2 via the experimental HTTP adapter so that the app works
 * regardless of network routing (Cloudflare WARP, IPv4-only, etc.).
 */

import { PrismaClient } from "@prisma/client";
import { PrismaClientOptions } from "@prisma/client/runtime/library";

// Re-usable singleton factory
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  } as PrismaClientOptions);
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof createPrismaClient>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? createPrismaClient();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
