// @ts-nocheck
/**
 * Aggregates a user's automated transaction history into context for the chat
 * model, so advice can cite the user's real figures.
 *
 * Mirrors the shared maths in frontend/src/lib/insights.ts. The two packages
 * are deployed independently (Vercel / Render) with no shared workspace, so the
 * aggregation used for the AI prompt lives here rather than being imported
 * across the boundary. Keep the week-window semantics in sync.
 */

export interface TxRow {
  amount: number;
  type: string;
  createdAt: string | Date;
}

export interface ActivityStats {
  thisWeekTotal: number;
  lastWeekTotal: number;
  allTimeTotal: number;
  byTypeAllTime: Record<string, number>;
  txCountThisWeek: number;
  txCountAllTime: number;
  largestTx: number;
  daysSinceLastTx: number | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function fmtXlm(amount: number, dp = 2): string {
  if (!Number.isFinite(amount)) return "0";
  const rounded = Number(amount.toFixed(dp));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(dp);
}

export function computeActivityStats(txs: TxRow[], now: number = Date.now()): ActivityStats {
  const rows = (txs ?? [])
    .filter((t) => t != null)
    .map((t) => ({
      amount: Math.abs(Number(t.amount)),
      type: t.type || "Other",
      time: t.createdAt instanceof Date ? t.createdAt.getTime() : new Date(t.createdAt).getTime(),
    }))
    .filter((t) => Number.isFinite(t.amount) && Number.isFinite(t.time));

  const stats: ActivityStats = {
    thisWeekTotal: 0,
    lastWeekTotal: 0,
    allTimeTotal: 0,
    byTypeAllTime: {},
    txCountThisWeek: 0,
    txCountAllTime: rows.length,
    largestTx: 0,
    daysSinceLastTx: null,
  };

  if (rows.length === 0) return stats;

  let latest = -Infinity;

  for (const tx of rows) {
    const age = now - tx.time;

    stats.allTimeTotal += tx.amount;
    stats.byTypeAllTime[tx.type] = (stats.byTypeAllTime[tx.type] ?? 0) + tx.amount;

    if (age < WEEK_MS) {
      stats.thisWeekTotal += tx.amount;
      stats.txCountThisWeek += 1;
    } else if (age < 2 * WEEK_MS) {
      stats.lastWeekTotal += tx.amount;
    }

    if (tx.amount > stats.largestTx) stats.largestTx = tx.amount;
    if (tx.time > latest) latest = tx.time;
  }

  stats.daysSinceLastTx = Math.max(0, Math.floor((now - latest) / DAY_MS));

  return stats;
}

/**
 * Render activity as a compact block for the model's system prompt.
 *
 * Deliberately limited to aggregates — no transaction hashes, memos or
 * counterparty addresses are sent to the third-party model.
 */
export function buildAiContext(stats: ActivityStats): string {
  if (stats.txCountAllTime === 0) {
    return "The user has no automated transaction history yet; their rules have not fired.";
  }

  const lines = [
    `- Automated this week: ${fmtXlm(stats.thisWeekTotal)} XLM across ${stats.txCountThisWeek} transfer(s)`,
    `- Automated previous week: ${fmtXlm(stats.lastWeekTotal)} XLM`,
    `- Automated all time: ${fmtXlm(stats.allTimeTotal)} XLM across ${stats.txCountAllTime} transfer(s)`,
    `- Largest single transfer: ${fmtXlm(stats.largestTx)} XLM`,
  ];

  const byType = Object.entries(stats.byTypeAllTime);
  if (byType.length > 0) {
    lines.push(
      `- By action (all time): ${byType.map(([t, v]) => `${t} ${fmtXlm(v)} XLM`).join(", ")}`,
    );
  }

  if (stats.daysSinceLastTx !== null) {
    lines.push(`- Days since last automated transfer: ${stats.daysSinceLastTx}`);
  }

  if (stats.lastWeekTotal > 0) {
    const change = Math.round(
      ((stats.thisWeekTotal - stats.lastWeekTotal) / stats.lastWeekTotal) * 100,
    );
    lines.push(`- Week-over-week change: ${change >= 0 ? "+" : ""}${change}%`);
  }

  return lines.join("\n");
}

/** Summarise the user's configured rules for the prompt. */
export function buildRuleContext(
  rules: Array<{ action: string; amount: number; isPercentage: boolean; status: string; trigger?: string }>,
): string {
  const safe = (rules ?? []).filter((r) => r != null);
  if (safe.length === 0) return "The user has no automation rules configured yet.";

  return safe
    .map(
      (r) =>
        `- ${r.action} ${r.amount}${r.isPercentage ? "%" : " XLM"}${
          r.trigger ? ` ${r.trigger}` : ""
        } (${r.status})`,
    )
    .join("\n");
}
