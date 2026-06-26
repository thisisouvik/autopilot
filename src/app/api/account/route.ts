import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

// GET /api/account — fetch limits, plan, wallet info
export async function GET() {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL!);

  const [userRows, ruleCount, txRows] = await Promise.all([
    sql`SELECT * FROM "User" WHERE id = ${user.id}::uuid LIMIT 1`,
    sql`SELECT COUNT(*) AS count FROM "Rule" WHERE "userId" = ${user.id}::uuid AND status = 'active'`,
    sql`
      SELECT * FROM "AutomatedTransaction"
      WHERE "userId" = ${user.id}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 100
    `,
  ]);

  const u = userRows[0];
  return NextResponse.json({
    publicKey: u.publicKey,
    dailyLimit: u.dailyLimit ?? null,
    weeklyLimit: u.weeklyLimit ?? null,
    plan: u.plan ?? "free",
    activeRules: Number(ruleCount[0]?.count ?? 0),
    transactions: txRows,
  });
}

// PATCH /api/account — update limits or plan
export async function PATCH(request: Request) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const sql = neon(process.env.DATABASE_URL!);

  await sql`
    UPDATE "User"
    SET
      "dailyLimit"  = CASE WHEN ${body.dailyLimit  !== undefined} THEN ${body.dailyLimit  ?? null} ELSE "dailyLimit"  END,
      "weeklyLimit" = CASE WHEN ${body.weeklyLimit !== undefined} THEN ${body.weeklyLimit ?? null} ELSE "weeklyLimit" END,
      "plan"        = CASE WHEN ${body.plan        !== undefined} THEN ${body.plan        ?? 'free'} ELSE "plan"    END,
      "updatedAt"   = NOW()
    WHERE id = ${user.id}::uuid
  `;

  return NextResponse.json({ success: true });
}
