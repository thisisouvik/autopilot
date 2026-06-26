import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

// PATCH /api/goals/[id] — update progress or link/unlink a rule
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();
    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      UPDATE "Goal"
      SET
        name            = COALESCE(${body.name ?? null}, name),
        "targetAmount"  = COALESCE(${body.targetAmount ?? null}, "targetAmount"),
        "currentAmount" = COALESCE(${body.currentAmount ?? null}, "currentAmount"),
        "linkedRuleId"  = CASE
          WHEN ${body.linkedRuleId !== undefined}
          THEN ${body.linkedRuleId ?? null}::uuid
          ELSE "linkedRuleId"
        END,
        "updatedAt"     = NOW()
      WHERE id = ${id}::uuid
        AND "userId" = ${user.id}::uuid
      RETURNING *
    `;

    if (rows.length === 0)
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    return NextResponse.json({ success: true, goal: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/goals/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const sql = neon(process.env.DATABASE_URL!);
    await sql`DELETE FROM "Goal" WHERE id = ${id}::uuid AND "userId" = ${user.id}::uuid`;
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
