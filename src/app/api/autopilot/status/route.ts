import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";
import { horizonServer } from "@/lib/engine";

/** GET /api/autopilot/status — engine status for the current user */
export async function GET() {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL!);

  const [txRows, ruleRows, engineBalance] = await Promise.all([
    // Last 5 automated transactions
    sql`
      SELECT * FROM "AutomatedTransaction"
      WHERE "userId" = ${user.id}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 5
    `,
    // Active rules count
    sql`
      SELECT COUNT(*) as count FROM "Rule"
      WHERE "userId" = ${user.id}::uuid AND status = 'active'
    `,
    // Engine account balance
    horizonServer
      .accounts()
      .accountId(process.env.AUTOPILOT_PUBLIC_KEY!)
      .call()
      .then((acc: any) => {
        const native = acc.balances?.find((b: any) => b.asset_type === "native");
        return native?.balance ?? "0";
      })
      .catch(() => "N/A"),
  ]);

  return NextResponse.json({
    enginePublicKey: process.env.AUTOPILOT_PUBLIC_KEY,
    engineBalance,
    activeRules: Number(ruleRows[0]?.count ?? 0),
    recentTransactions: txRows,
  });
}
