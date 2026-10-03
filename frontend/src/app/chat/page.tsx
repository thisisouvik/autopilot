import DashboardShell from "@/components/DashboardShell";
import ChatClient from "./ChatClient";
import { getSession } from "@/lib/session";
import { neon } from "@neondatabase/serverless";

export default async function ChatPage() {
  const session = await getSession();
  const sql = neon(process.env.DATABASE_URL!);

  const [rawRules, rawTxs] = await Promise.all([
    sql`
      SELECT r.id,
             r.trigger,
             r.action,
             r.amount,
             r."isPercentage",
             r.status,
             r.description
      FROM   "Rule" r
      JOIN   "User" u ON r."userId" = u.id
      WHERE  u."publicKey" = ${session.publicKey}
      ORDER  BY r."createdAt" DESC
    `.catch(() => []),
    // Trailing 90 days of automation activity backs the Coach insights. Only
    // the aggregate fields are selected — no tx hashes or memos reach the client.
    sql`
      SELECT t.amount, t.type, t."ruleId", t."createdAt"
      FROM   "AutomatedTransaction" t
      JOIN   "User" u ON t."userId" = u.id
      WHERE  u."publicKey" = ${session.publicKey}
        AND  t."createdAt" > NOW() - INTERVAL '90 days'
      ORDER  BY t."createdAt" DESC
      LIMIT  500
    `.catch(() => []),
  ]);

  // Normalise to camelCase so ChatClient never receives undefined fields
  const rules = (rawRules as any[])
    .filter((r) => r != null && r.id != null)
    .map((r) => ({
      id:          r.id,
      trigger:     r.trigger     ?? "",
      action:      r.action      ?? "",
      amount:      Number(r.amount ?? 0),
      isPercentage: r.isPercentage ?? r.is_percentage ?? false,
      status:      r.status      ?? "active",
      description: r.description ?? null,
    }));

  const transactions = (rawTxs as any[])
    .filter((t) => t != null)
    .map((t) => ({
      amount: Number(t.amount ?? 0),
      type: t.type ?? "Other",
      ruleId: t.ruleId ?? t.rule_id ?? null,
      // Serialise to ISO so the value survives the server→client boundary.
      // Fallback to epoch 0 rather than Date.now() to keep this pure.
      createdAt: new Date(t.createdAt ?? t.created_at ?? 0).toISOString(),
    }));

  return (
    <DashboardShell publicKey={session.publicKey}>
      <ChatClient initialRules={rules} initialTransactions={transactions} />
    </DashboardShell>
  );
}
