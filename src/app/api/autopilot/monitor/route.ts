/**
 * POST /api/autopilot/monitor
 *
 * The automation rule engine endpoint.
 * Called by the background worker every 30s (or manually for testing).
 *
 * Flow:
 *  1. Fetch all users with active rules from DB
 *  2. For each user, fetch their recent Stellar payments from Horizon
 *  3. Match each unprocessed payment against their active rules
 *  4. Execute matched rules → submit Stellar transaction → record in DB
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  fetchRecentPayments,
  executeRuleTransaction,
  isPaymentAlreadyProcessed,
} from "@/lib/engine";

// Internal secret to prevent unauthorized calls
const ENGINE_SECRET = process.env.ENGINE_SECRET ?? process.env.JWT_SECRET ?? "dev-engine-secret";

export async function POST(request: Request) {
  // Validate caller
  const authHeader = request.headers.get("x-engine-secret");
  if (authHeader !== ENGINE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Get all users who have at least one active rule (include spending limits)
    const users = await sql`
      SELECT DISTINCT u.id, u."publicKey", u."dailyLimit", u."weeklyLimit"
      FROM "User" u
      INNER JOIN "Rule" r ON r."userId" = u.id
      WHERE r.status = 'active'
    `;

    const results: ExecutionResult[] = [];

    for (const user of users) {
      // 2. Get this user's active rules
      const rules = await sql`
        SELECT * FROM "Rule"
        WHERE "userId" = ${user.id}::uuid
          AND status = 'active'
        ORDER BY "createdAt" DESC
      `;

      // 2b. Calculate how much has already been automated today/this week
      const now = new Date();
      const startOfDay  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [daySpend, weekSpend] = await Promise.all([
        sql`SELECT COALESCE(SUM(amount), 0) AS total FROM "AutomatedTransaction" WHERE "userId" = ${user.id}::uuid AND "createdAt" >= ${startOfDay}`,
        sql`SELECT COALESCE(SUM(amount), 0) AS total FROM "AutomatedTransaction" WHERE "userId" = ${user.id}::uuid AND "createdAt" >= ${startOfWeek}`,
      ]);

      let spentToday  = parseFloat(daySpend[0]?.total  ?? "0");
      let spentWeek   = parseFloat(weekSpend[0]?.total ?? "0");
      const dailyLimit  = user.dailyLimit  ? parseFloat(user.dailyLimit)  : null;
      const weeklyLimit = user.weeklyLimit ? parseFloat(user.weeklyLimit) : null;

      // 3. Get recent incoming payments from Horizon
      const payments = await fetchRecentPayments(user.publicKey, 10);

      for (const payment of payments) {
        // 4. Deduplicate — skip already-processed payments
        const alreadyDone = await isPaymentAlreadyProcessed(payment.id, sql);
        if (alreadyDone) continue;

        const paymentAmountXLM = parseFloat(payment.amount);

        // 5. Match against rules
        for (const rule of rules) {
          const matches = doesPaymentMatchRule(
            payment,
            rule as { trigger: string; action: string }
          );
          if (!matches) continue;

          // 6. Calculate execution amount
          const execAmount = rule.isPercentage
            ? (rule.amount / 100) * paymentAmountXLM
            : rule.amount;

          if (execAmount <= 0.0000001) continue;
          if (execAmount > paymentAmountXLM) {
            // Never move more than what was received
            continue;
          }

          const execAmountStr = execAmount.toFixed(7);

          // 7a. Enforce spending limits
          if (dailyLimit !== null && spentToday + execAmount > dailyLimit) {
            console.log(`[Engine] ⚠ Daily limit reached for ${user.publicKey.slice(0, 8)}… (${spentToday.toFixed(2)} / ${dailyLimit} XLM today)`);
            continue;
          }
          if (weeklyLimit !== null && spentWeek + execAmount > weeklyLimit) {
            console.log(`[Engine] ⚠ Weekly limit reached for ${user.publicKey.slice(0, 8)}…`);
            continue;
          }

          // 7b. Determine destination (engine's own account acts as savings vault for testnet)
          const destination = process.env.AUTOPILOT_PUBLIC_KEY!;
          const memo = rule.memo ?? `AutoPilot: ${rule.action} ${execAmountStr} XLM`;

          try {
            // 8. Execute Stellar transaction
            const txHash = await executeRuleTransaction(destination, execAmountStr, memo);

            // 9. Record in DB
            await sql`
              INSERT INTO "AutomatedTransaction" (
                id, "userId", "ruleId", amount, type, memo, "txHash", "createdAt"
              )
              VALUES (
                gen_random_uuid(),
                ${user.id}::uuid,
                ${rule.id}::uuid,
                ${execAmount},
                ${rule.action.toLowerCase()},
                ${memo},
                ${payment.id},
                NOW()
              )
            `;

            results.push({
              userId: user.id,
              publicKey: user.publicKey,
              ruleId: rule.id,
              ruleAction: rule.action,
              amount: execAmountStr,
              txHash,
              paymentId: payment.id,
              status: "executed",
            });

            // Update in-memory spend counters so later rules in this cycle see the cap
            spentToday += execAmount;
            spentWeek  += execAmount;

            console.log(
              `[Engine] ✓ Rule "${rule.action}" executed for ${user.publicKey.slice(0, 8)}… | ${execAmountStr} XLM | tx: ${txHash.slice(0, 16)}…`
            );
          } catch (execErr: any) {
            console.error(`[Engine] ✗ Rule execution failed:`, execErr?.message ?? execErr);
            results.push({
              userId: user.id,
              publicKey: user.publicKey,
              ruleId: rule.id,
              ruleAction: rule.action,
              amount: execAmountStr,
              txHash: null,
              paymentId: payment.id,
              status: "failed",
              error: execErr?.message,
            });
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      usersChecked: users.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Engine] Monitor error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Also allow GET for manual trigger from browser (dev only)
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const req = new Request("http://localhost/api/autopilot/monitor", {
    method: "POST",
    headers: {
      "x-engine-secret": process.env.ENGINE_SECRET ?? process.env.JWT_SECRET ?? "dev-engine-secret",
    },
    body: null,
  });
  return POST(req);
}

// ── Rule matching logic ───────────────────────────────────────────────────────
function doesPaymentMatchRule(
  payment: { amount: string; asset: string; from: string },
  rule: { trigger: string; action: string }
): boolean {
  const trigger = rule.trigger.toLowerCase();
  const isXLM = payment.asset === "XLM";

  // "on every payment received" / "every payment" / "receive payment"
  if (
    trigger.includes("every payment") ||
    trigger.includes("payment received") ||
    trigger.includes("receive") ||
    trigger.includes("incoming")
  ) {
    return isXLM;
  }

  // "weekly" / "every week" triggers are time-based — handled separately
  // For now, payment-based triggers only
  return false;
}

interface ExecutionResult {
  userId: string;
  publicKey: string;
  ruleId: string;
  ruleAction: string;
  amount: string;
  txHash: string | null;
  paymentId: string;
  status: "executed" | "failed";
  error?: string;
}
