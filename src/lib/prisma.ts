import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

// Use ws for WebSocket in Node.js (non-Edge) environment
neonConfig.webSocketConstructor = ws

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
  const adapter = new PrismaNeon(pool)
  return new PrismaClient({ adapter })
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof createPrismaClient>
} & typeof global

const prisma = globalThis.prismaGlobal ?? createPrismaClient()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
