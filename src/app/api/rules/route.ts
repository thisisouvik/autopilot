import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

// POST /api/rules — activate a rule
export async function POST(request: Request) {
  const user = await getUserFromRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { trigger, action, amount, isPercentage, limits, description, memo } = body;

    if (!trigger || !action || amount === undefined) {
      return NextResponse.json({ error: "Missing required rule fields" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      INSERT INTO "Rule" (
        id, "userId", trigger, action, amount, "isPercentage",
        limits, status, description, memo, "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        ${user.id},
        ${trigger},
        ${action},
        ${Number(amount)},
        ${Boolean(isPercentage)},
        ${JSON.stringify(limits ?? {})}::jsonb,
        'active',
        ${description ?? null},
        ${memo ?? null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, rule: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Rules POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/rules — list user's rules
export async function GET() {
  const user = await getUserFromRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rules = await sql`
      SELECT * FROM "Rule"
      WHERE "userId" = ${user.id}
      ORDER BY "createdAt" DESC
    `;
    return NextResponse.json({ rules });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Rules GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
