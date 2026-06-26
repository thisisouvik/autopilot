import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    console.log("Adding Goal table...");
    await sql`
      CREATE TABLE IF NOT EXISTS "Goal" (
        "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
        "userId"        UUID        NOT NULL,
        "name"          TEXT        NOT NULL,
        "targetAmount"  DOUBLE PRECISION NOT NULL,
        "currentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "emoji"         TEXT        NOT NULL DEFAULT '🎯',
        "linkedRuleId"  UUID,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
      );
    `;
    // Add FK only if not already present
    const existing = await sql`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'Goal_userId_fkey'
    `;
    if (existing.length === 0) {
      await sql`
        ALTER TABLE "Goal"
        ADD CONSTRAINT "Goal_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      `;
    }
    console.log("Goal table created!");
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
