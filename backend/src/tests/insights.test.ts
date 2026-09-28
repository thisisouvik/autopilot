// @ts-nocheck
import { describe, it, expect } from "vitest";
import { buildAiContext, buildRuleContext, computeActivityStats, type TxRow } from "../lib/insights";

const NOW = new Date("2026-03-15T12:00:00Z").getTime();
const DAY = 86_400_000;

/** A transaction `daysAgo` before the fixed NOW. */
function tx(amount: number, daysAgo: number, type = "Save"): TxRow {
  return { amount, type, createdAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

describe("computeActivityStats", () => {
  it("returns a zeroed shape for no history", () => {
    const stats = computeActivityStats([], NOW);
    expect(stats.txCountAllTime).toBe(0);
    expect(stats.allTimeTotal).toBe(0);
    expect(stats.daysSinceLastTx).toBeNull();
  });

  it("splits totals across the trailing two weeks", () => {
    const stats = computeActivityStats(
      [tx(10, 1), tx(15, 3), tx(20, 9), tx(5, 40)],
      NOW,
    );

    expect(stats.thisWeekTotal).toBe(25);
    expect(stats.lastWeekTotal).toBe(20);
    expect(stats.allTimeTotal).toBe(50);
    expect(stats.txCountThisWeek).toBe(2);
    expect(stats.txCountAllTime).toBe(4);
  });

  it("excludes the boundary day from the current week", () => {
    // Exactly 7 days old falls into the previous week, not the current one.
    const stats = computeActivityStats([tx(10, 7)], NOW);
    expect(stats.thisWeekTotal).toBe(0);
    expect(stats.lastWeekTotal).toBe(10);
  });

  it("groups totals by action type", () => {
    const stats = computeActivityStats(
      [tx(10, 1, "Save"), tx(4, 2, "Invest"), tx(6, 2, "Save")],
      NOW,
    );
    expect(stats.byTypeAllTime).toEqual({ Save: 16, Invest: 4 });
  });

  it("tracks the largest transfer and recency", () => {
    const stats = computeActivityStats([tx(10, 5), tx(99, 12), tx(3, 2)], NOW);
    expect(stats.largestTx).toBe(99);
    expect(stats.daysSinceLastTx).toBe(2);
  });

  it("normalises negative amounts to magnitudes", () => {
    // A ledger recording outflows as negatives must still aggregate.
    const stats = computeActivityStats([tx(-25, 1)], NOW);
    expect(stats.allTimeTotal).toBe(25);
    expect(stats.largestTx).toBe(25);
  });

  it("discards rows with unusable amounts or dates", () => {
    const rows = [
      tx(10, 1),
      { amount: NaN, type: "Save", createdAt: new Date(NOW).toISOString() },
      { amount: 5, type: "Save", createdAt: "not-a-date" },
      null as any,
    ];
    const stats = computeActivityStats(rows, NOW);
    expect(stats.txCountAllTime).toBe(1);
    expect(stats.allTimeTotal).toBe(10);
  });

  it("counts future-dated rows in the current week", () => {
    // Clock skew must not leak a transaction into the previous week.
    const stats = computeActivityStats([tx(10, -1)], NOW);
    expect(stats.thisWeekTotal).toBe(10);
    expect(stats.lastWeekTotal).toBe(0);
    expect(stats.daysSinceLastTx).toBe(0);
  });
});

describe("buildAiContext", () => {
  it("states plainly when there is no history", () => {
    const text = buildAiContext(computeActivityStats([], NOW));
    expect(text).toMatch(/no automated transaction history/i);
  });

  it("includes real figures the model can cite", () => {
    const text = buildAiContext(computeActivityStats([tx(30, 1), tx(20, 9)], NOW));
    expect(text).toContain("30 XLM");
    expect(text).toContain("20 XLM");
    expect(text).toContain("Automated all time: 50 XLM");
  });

  it("reports week-over-week change only when a prior week exists", () => {
    const withPrior = buildAiContext(computeActivityStats([tx(15, 1), tx(10, 9)], NOW));
    expect(withPrior).toContain("Week-over-week change: +50%");

    const noPrior = buildAiContext(computeActivityStats([tx(15, 1)], NOW));
    expect(/Week-over-week/.test(noPrior)).toBe(false);
  });

  it("leaks no transaction identifiers", () => {
    const rows = [{ amount: 10, type: "Save", createdAt: new Date(NOW - DAY).toISOString() }];
    const text = buildAiContext(computeActivityStats(rows, NOW));
    expect(/txHash|memo|G[A-Z0-9]{20}/.test(text)).toBe(false);
  });
});

describe("buildRuleContext", () => {
  it("handles an empty configuration", () => {
    expect(buildRuleContext([])).toMatch(/no automation rules/i);
  });

  it("renders percentage and fixed rules distinctly", () => {
    const text = buildRuleContext([
      { action: "Save", amount: 10, isPercentage: true, status: "active", trigger: "on payment" },
      { action: "Invest", amount: 5, isPercentage: false, status: "paused" },
    ]);
    expect(text).toContain("Save 10% on payment (active)");
    expect(text).toContain("Invest 5 XLM (paused)");
  });
});
