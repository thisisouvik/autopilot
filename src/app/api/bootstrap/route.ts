import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

/**
 * GET /api/bootstrap — idempotent table creation called once on app start.
 * Safe to call multiple times since all statements use IF NOT EXISTS.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "Goal" (
        "id"            UUID             NOT NULL DEFAULT gen_random_uuid(),
        "userId"        UUID             NOT NULL,
        "name"          TEXT             NOT NULL,
        "targetAmount"  DOUBLE PRECISION NOT NULL,
        "currentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "emoji"         TEXT             NOT NULL DEFAULT '🎯',
        "linkedRuleId"  UUID,
        "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
      )
    `;

    const fkExists = await sql`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'Goal_userId_fkey'
    `;
    if (fkExists.length === 0) {
      await sql`
        ALTER TABLE "Goal"
        ADD CONSTRAINT "Goal_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
      `;
    }

    return NextResponse.json({ ok: true, message: "Schema up to date." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
