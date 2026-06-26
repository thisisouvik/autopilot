import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

// GET /api/goals — list user goals
export async function GET() {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const goals = await sql`
      SELECT * FROM "Goal"
      WHERE "userId" = ${user.id}::uuid
      ORDER BY "createdAt" DESC
    `;
    return NextResponse.json({ goals });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/goals — create a new goal
export async function POST(request: Request) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { name, targetAmount, currentAmount, emoji } = body;

    if (!name || !targetAmount) {
      return NextResponse.json({ error: "name and targetAmount are required" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      INSERT INTO "Goal" (
        id, "userId", name, "targetAmount", "currentAmount", emoji, "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        ${user.id}::uuid,
        ${name},
        ${Number(targetAmount)},
        ${Number(currentAmount ?? 0)},
        ${emoji ?? "🎯"},
        NOW(),
        NOW()
      )
      RETURNING *
    `;
    return NextResponse.json({ success: true, goal: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Goals POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
