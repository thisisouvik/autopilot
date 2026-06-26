import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

// PATCH /api/rules/[id] — toggle status (active/paused) or update fields
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
      UPDATE "Rule"
      SET
        status      = COALESCE(${body.status ?? null}, status),
        trigger     = COALESCE(${body.trigger ?? null}, trigger),
        action      = COALESCE(${body.action ?? null}, action),
        amount      = COALESCE(${body.amount ?? null}, amount),
        description = COALESCE(${body.description ?? null}, description),
        memo        = COALESCE(${body.memo ?? null}, memo),
        "updatedAt" = NOW()
      WHERE id = ${id}::uuid
        AND "userId" = ${user.id}::uuid
      RETURNING *
    `;

    if (rows.length === 0)
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    return NextResponse.json({ success: true, rule: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Rules PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/rules/[id] — remove a rule
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const sql = neon(process.env.DATABASE_URL!);

    await sql`
      DELETE FROM "Rule"
      WHERE id = ${id}::uuid
        AND "userId" = ${user.id}::uuid
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Rules DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
