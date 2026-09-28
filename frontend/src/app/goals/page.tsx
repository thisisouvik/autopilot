/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import DashboardShell from "@/components/DashboardShell";
import GoalsClient from "./GoalsClient";
import { getSession } from "@/lib/session";
import { neon } from "@neondatabase/serverless";

export default async function GoalsPage() {
  const session = await getSession();
  const sql = neon(process.env.DATABASE_URL!);

  const [rawGoals, rawRules] = await Promise.all([
    sql`
      SELECT g.id, g.name,
             g.asset,
             g."targetAmount",
             g."currentAmount",
             g.emoji,
             g."linkedRuleId",
             g."createdAt"
      FROM   "Goal" g
      JOIN   "User" u ON g."userId" = u.id
      WHERE  u."publicKey" = ${session.publicKey}
      ORDER  BY g."createdAt" DESC
      LIMIT  50
    `.catch(() => []),
    sql`
      SELECT r.id, r.description, r.action, r.trigger, r.memo,
             r.amount, r."isPercentage", r.status
      FROM   "Rule" r
      JOIN   "User" u ON r."userId" = u.id
      WHERE  u."publicKey" = ${session.publicKey}
      ORDER  BY r."createdAt" DESC
      LIMIT  20
    `.catch(() => []),
  ]);

  // Historical trigger frequency per rule drives the goal ETAs, replacing the
  // previous hardcoded "50 XLM average payment, 4 triggers/week" guess.
  const rawTxs = await sql`
    SELECT t.amount, t.type, t."ruleId", t."createdAt"
    FROM   "AutomatedTransaction" t
    JOIN   "User" u ON t."userId" = u.id
    WHERE  u."publicKey" = ${session.publicKey}
      AND  t."createdAt" > NOW() - INTERVAL '180 days'
    ORDER  BY t."createdAt" DESC
    LIMIT  1000
  `.catch(() => []);

  // Explicitly normalise to camelCase so GoalsClient never sees undefined fields
  const goals = (rawGoals as any[]).map((g) => ({
    id:           g.id,
    name:         g.name,
    asset:        g.asset === "USDC" ? "USDC" : "XLM",
    targetAmount: Number(g.targetAmount ?? g.target_amount ?? 0),
    currentAmount: Number(g.currentAmount ?? g.current_amount ?? 0),
    emoji:        g.emoji ?? "🎯",
    linkedRuleId: g.linkedRuleId ?? g.linked_rule_id ?? null,
    createdAt:    g.createdAt ?? g.created_at,
  }));

  const rules = (rawRules as any[]).map((r) => ({
    id:          r.id,
    description: r.description ?? null,
    trigger:     r.trigger ?? null,
    memo:        r.memo ?? null,
    action:      r.action,
    amount:      Number(r.amount ?? 0),
    isPercentage: r.isPercentage ?? r.is_percentage ?? false,
    status:      r.status,
  }));

  const transactions = (rawTxs as any[])
    .filter((t) => t != null)
    .map((t) => ({
      amount: Number(t.amount ?? 0),
      type: t.type ?? "Other",
      ruleId: t.ruleId ?? t.rule_id ?? null,
      createdAt: new Date(t.createdAt ?? t.created_at ?? Date.now()).toISOString(),
    }));

  return (
    <DashboardShell publicKey={session.publicKey}>
      <GoalsClient initialGoals={goals} rules={rules} transactions={transactions} />
    </DashboardShell>
  );
}
