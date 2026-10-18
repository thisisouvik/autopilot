/**
 * BullMQ Payment Event Processor
 *
 * Steps for every payment job:
 *  1. Query active rules for this user
 *  2. Match rules against the payment trigger
 *  3. Calculate execution amount (flat or percentage)
 *  4. Check daily/weekly spending limit via Redis
 *  5. Build + sign + submit the Stellar transaction
 *  6. Record the transaction in the DB
 *  7. Update Redis spend counters
 *
 * processPaymentDirect() is also exported for direct invocation
 * from the Horizon stream — so rules fire even when BullMQ/Redis is down.
 */

import { Worker, Job } from "bullmq";
import { getDb } from "../lib/db";
import { claimPayment, executeRuleTransaction } from "../lib/engine";
import { doesPaymentMatchTrigger } from "../lib/paymentTrigger";
import { readConfiguredLimit } from "../lib/pagination";
import { checkSpendingLimit, recordSpend, rollbackSpend } from "./limitGuard";
import { PAYMENT_QUEUE_NAME, PaymentJobData, CronJobData, CRON_QUEUE_NAME, getConnectionOptions } from "./queue";

export type SupportedAsset = "XLM" | "USDC";

export const DEFAULT_MAX_RULES_PER_USER = 20;

/**
 * Parse an asset identifier string (e.g. "XLM", "USDC:G...") into supported asset code.
 */
export function parseAssetCode(asset: string): SupportedAsset | null {
  const code = asset === "XLM" ? "XLM" : asset.split(":")[0]?.toUpperCase();
  return code === "XLM" || code === "USDC" ? code : null;
}

export interface RuleExecutionResult {
  ruleId: string;
  status: "executed" | "failed" | "blocked" | "skipped";
  txHash?: string;
  amount?: string;
  asset?: SupportedAsset;
  destination?: string;
  reason?: string;
  error?: string;
}

export interface ProcessPaymentResult {
  skipped?: boolean;
  reason?: string;
  processed?: number;
  results?: RuleExecutionResult[];
}

export interface ProcessCronResult {
  status: "executed" | "blocked" | "skipped";
  txHash?: string;
  amount?: string;
  reason?: string;
  skipped?: boolean;
}

/**
 * Core payment processing logic — exported for direct use.
 * Called by both the BullMQ worker AND directly from the Horizon stream.
 */
export async function processPaymentDirect(data: PaymentJobData): Promise<ProcessPaymentResult> {
  const { userId, publicKey, paymentHorizonId, amount, asset } = data;
  const sql = getDb();
  const maxRules = readConfiguredLimit("MAX_RULES_PER_USER", DEFAULT_MAX_RULES_PER_USER);

  console.log(`[Processor] ⚡ Processing ${amount} ${asset} for ${publicKey.slice(0, 8)}…`);

  // ── Step 1: Fetch user + active rules
  const [userRows, rules] = await Promise.all([
    sql`SELECT id, "dailyLimit", "weeklyLimit" FROM "User" WHERE id = ${userId}::uuid LIMIT 1`,
    sql`
      SELECT * FROM "Rule"
      WHERE "userId" = ${userId}::uuid AND status = 'active'
      ORDER BY "createdAt" ASC
      LIMIT ${maxRules}
    `,
  ]);

  if (userRows.length === 0) {
    console.warn(`[Processor] ⚠ User ${userId} not found`);
    return { skipped: true, reason: "user_not_found" };
  }

  console.log(`[Processor] 📋 ${rules.length} active rule(s) for user ${userId.slice(0, 8)}…`);
  if (rules.length === 0) return { skipped: true, reason: "no_rules" };

  const user = userRows[0];
  const dailyLimit  = user.dailyLimit  ? parseFloat(user.dailyLimit)  : null;
  const weeklyLimit = user.weeklyLimit ? parseFloat(user.weeklyLimit) : null;
  const paymentAmount = parseFloat(amount);
  // Rules execute in the same asset that was received.
  const assetCode = parseAssetCode(asset);

  // ── Step 3: Fetch vaults
  const vaults = await sql`
    SELECT type, "publicKey" FROM "Vault"
    WHERE "userId" = ${userId}::uuid
  `;
  const savingsVault = vaults.find((v: any) => v.type === "savings");
  const investVault  = vaults.find((v: any) => v.type === "investment");

  const results: RuleExecutionResult[] = [];
  let paymentClaimed = false;

  // ── Step 4: Match + execute each rule
  for (const rule of rules) {
    const triggerMatches = doesPaymentMatchTrigger(rule.trigger as string, asset);
    console.log(`[Processor] 🔍 Rule "${rule.trigger}" | matches: ${triggerMatches}`);
    if (!triggerMatches) continue;

    const paymentStroops = Math.round(paymentAmount * 10000000);
    const ruleAmountFloat = parseFloat(rule.amount);

    let execStroops: number;
    if (rule.isPercentage) {
      execStroops = Math.round((paymentStroops * ruleAmountFloat) / 100);
    } else {
      execStroops = Math.round(ruleAmountFloat * 10000000);
    }

    const execAmount = execStroops / 10000000;

    console.log(`[Processor] 💰 Exec: ${execAmount} ${assetCode} (${rule.isPercentage ? `${rule.amount}%` : "flat"} of ${paymentAmount})`);

    if (execStroops <= 0) { console.log("[Processor] ⚠ Amount too small — skipping"); continue; }
    if (execStroops > paymentStroops) {
      console.log(`[Processor] ⚠ Rule amount ${execAmount} > payment ${paymentAmount} — skipping`);
      continue;
    }

    const execAmountStr = execAmount.toFixed(7);

    // ── Determine destination vault
    const action = (rule.action as string).toLowerCase();
    let destination: string | null = null;

    if (action.includes("save") || action.includes("saving")) {
      destination = savingsVault?.publicKey ?? null;
    } else if (action.includes("invest") || action.includes("investment")) {
      destination = investVault?.publicKey ?? null;
    }

    if (!destination) {
      console.warn(`[Processor] ⚠ No ${action} vault found — user must create one in the Vault tab`);
      results.push({ ruleId: rule.id, status: "failed", error: "No vault found — create one in the Vault tab" });
      continue;
    }

    if (!paymentClaimed) {
      // The unique paymentId constraint makes this claim atomic across workers.
      paymentClaimed = await claimPayment(paymentHorizonId, userId, sql);
      if (!paymentClaimed) {
        console.log(`[Processor] ⏭ Already processed ${paymentHorizonId.slice(0, 16)}… — skipping`);
        return { skipped: true, reason: "duplicate" };
      }
    }

    // ── Spending limit check (fail-closed, atomic reservation prevents TOCTOU race conditions)
    let limitReserved = false;
    try {
      const limitCheck = await checkSpendingLimit(userId, execAmount, dailyLimit, weeklyLimit);
      if (!limitCheck.allowed) {
        console.log(`[Processor] 🚫 Limit blocked rule ${rule.id}: ${limitCheck.reason}`);
        results.push({ ruleId: rule.id, status: "blocked", reason: limitCheck.reason });
        continue;
      }
      limitReserved = limitCheck.reserved ?? false;
    } catch (limitErr: any) {
      console.error("[Processor] 🚫 Spending limit check error (failing closed):", limitErr?.message);
      results.push({ ruleId: rule.id, status: "blocked", reason: `Spending limit verification failed: ${limitErr?.message}` });
      continue;
    }

    const memo = (rule.memo as string | null) ?? `AutoPilot:${action}`.slice(0, 28);
    console.log(`[Processor] 🚀 Sending ${execAmountStr} ${assetCode} → ${destination.slice(0, 8)}… (${action})`);

    try {
      // assetCode is non-null here — doesPaymentMatchTrigger() rejects unsupported assets.
      const txHash = await executeRuleTransaction(destination, execAmountStr, memo, assetCode!);

      try {
        await sql`
          INSERT INTO "AutomatedTransaction"
            (id, "userId", "ruleId", amount, type, asset, memo, "txHash", "createdAt")
          VALUES
            (gen_random_uuid(), ${userId}::uuid, ${rule.id}::uuid,
             ${execAmount}, ${action}, ${assetCode}, ${memo}, ${txHash}, NOW())
        `;
      } catch (insertErr: any) {
        if (insertErr.code === '23505' || (insertErr.message && insertErr.message.includes('AutomatedTransaction_txHash_key'))) {
          console.log(`[Processor] ⏭ Duplicate txHash ${txHash} detected — skipping as it was already processed by another worker`);
          continue;
        }
        throw insertErr;
      }

      // ── Step 8: Increment linked Goal's currentAmount ──────────────
      // Only credit goals denominated in the asset that just moved: adding
      // 5 USDC to a 1000 XLM goal would silently corrupt its progress.
      try {
        await sql`
          UPDATE "Goal"
          SET
            "currentAmount" = "currentAmount" + ${execAmount},
            "updatedAt" = NOW()
          WHERE "linkedRuleId" = ${rule.id}::uuid
            AND "userId" = ${userId}::uuid
            AND asset = ${assetCode}
            AND "currentAmount" < "targetAmount"
        `;
      } catch (goalErr: any) {
        console.warn(`[Processor] ⚠ Could not update goal for rule ${rule.id}:`, goalErr?.message);
      }

      // If spend was not pre-reserved via checkSpendingLimit, record now
      if (!limitReserved) {
        try { await recordSpend(userId, execAmount); } catch {}
      }

      console.log(`[Processor] ✅ Rule "${rule.action}" | ${execAmountStr} ${assetCode} → vault | tx: ${txHash.slice(0, 20)}…`);
      results.push({ ruleId: rule.id, status: "executed", txHash, amount: execAmountStr, asset: assetCode, destination });

    } catch (txErr: any) {
      // Transaction failed — roll back reserved spend in Redis
      if (limitReserved) {
        await rollbackSpend(userId, execAmount).catch((rbErr) =>
          console.error(`[Processor] ⚠ Failed to rollback spend for rule ${rule.id}:`, rbErr?.message)
        );
      }
      console.error(`[Processor] ✗ Tx failed for rule ${rule.id}:`, txErr?.message ?? txErr);
      results.push({ ruleId: rule.id, status: "failed", error: txErr?.message });
    }
  }

  return { processed: results.length, results };
}

// ── BullMQ worker wrapper ─────────────────────────────────────────────────

async function processPaymentJob(job: Job<PaymentJobData>): Promise<ProcessPaymentResult> {
  return processPaymentDirect(job.data);
}

async function processCronJob(job: Job<CronJobData>): Promise<ProcessCronResult> {
  const { userId, ruleId, amount, isPercentage, action, memo } = job.data;
  const sql = getDb();

  console.log(`[Processor] ⏰ Cron job for rule ${ruleId}`);

  const execAmount = amount;
  if (execAmount <= 0) return { skipped: true, reason: "zero_amount" };

  const [userRows, vaults] = await Promise.all([
    sql`
      SELECT id, "dailyLimit", "weeklyLimit" FROM "User" WHERE id = ${userId}::uuid LIMIT 1
    `,
    sql`
      SELECT type, "publicKey" FROM "Vault"
      WHERE "userId" = ${userId}::uuid
    `,
  ]);
  if (userRows.length === 0) return { skipped: true, reason: "user_not_found" };

  const savingsVault = vaults.find((v: any) => v.type === "savings");
  const investVault  = vaults.find((v: any) => v.type === "investment");

  const actionLower = (action ?? "").toLowerCase();
  let destination: string | null = null;

  if (actionLower.includes("save") || actionLower.includes("saving")) {
    destination = savingsVault?.publicKey ?? null;
  } else if (actionLower.includes("invest") || actionLower.includes("investment")) {
    destination = investVault?.publicKey ?? null;
  }

  if (!destination) {
    console.warn(`[Processor] ⚠ No ${action} vault found for cron rule ${ruleId} — user must create one in the Vault tab`);
    return { status: "failed", error: "No vault found — create one in the Vault tab" };
  }

  const user = userRows[0];
  let limitReserved = false;
  try {
    const limitCheck = await checkSpendingLimit(
      userId, execAmount,
      user.dailyLimit ? parseFloat(user.dailyLimit) : null,
      user.weeklyLimit ? parseFloat(user.weeklyLimit) : null
    );

    if (!limitCheck.allowed) {
      console.log(`[Processor] 🚫 Cron rule ${ruleId} blocked: ${limitCheck.reason}`);
      return { status: "blocked", reason: limitCheck.reason };
    }
    limitReserved = limitCheck.reserved ?? false;
  } catch (limitErr: any) {
    console.error(`[Processor] 🚫 Cron rule ${ruleId} blocked due to limit verification error (failing closed):`, limitErr?.message);
    return { status: "blocked", reason: `Spending limit verification error: ${limitErr?.message}` };
  }

  const memoText = (memo ?? `AutoPilot:${action}:${execAmount}`).slice(0, 28);
  const execAmountStr = execAmount.toFixed(7);
  // Scheduled rules carry their own asset (there is no incoming payment to
  // infer it from); default to XLM so existing cron jobs are unaffected.
  const cronAsset: SupportedAsset = job.data.asset === "USDC" ? "USDC" : "XLM";

  try {
    const txHash = await executeRuleTransaction(destination, execAmountStr, memoText, cronAsset);
    try {
      await sql`
        INSERT INTO "AutomatedTransaction"
          (id, "userId", "ruleId", amount, type, asset, memo, "txHash", "createdAt")
        VALUES
          (gen_random_uuid(), ${userId}::uuid, ${ruleId}::uuid,
           ${execAmount}, ${action.toLowerCase()}, ${cronAsset}, ${memoText}, ${txHash}, NOW())
      `;
    } catch (insertErr: any) {
      if (insertErr.code === '23505' || (insertErr.message && insertErr.message.includes('AutomatedTransaction_txHash_key'))) {
        console.log(`[Processor] ⏭ Duplicate cron txHash ${txHash} detected — skipping`);
        return { status: "skipped", reason: "duplicate_txHash" };
      }
      throw insertErr;
    }

    // Step: Increment linked Goal's currentAmount (if any)
    try {
      await sql`
        UPDATE "Goal"
        SET
          "currentAmount" = "currentAmount" + ${execAmount},
          "updatedAt" = NOW()
        WHERE "linkedRuleId" = ${ruleId}::uuid
          AND "userId" = ${userId}::uuid
          AND asset = ${cronAsset}
          AND "currentAmount" < "targetAmount"
      `;
    } catch (goalErr: any) {
      console.warn(`[Processor] ⚠ Could not update goal for cron rule ${ruleId}:`, goalErr?.message);
    }

    if (!limitReserved) {
      try { await recordSpend(userId, execAmount); } catch {}
    }
    console.log(`[Processor] ✅ Cron rule "${action}" | ${execAmountStr} ${cronAsset} → vault | tx: ${txHash.slice(0, 20)}…`);
    return { status: "executed", txHash, amount: execAmountStr, destination };
  } catch (err: any) {
    if (limitReserved) {
      await rollbackSpend(userId, execAmount).catch((rbErr) =>
        console.error(`[Processor] ⚠ Failed to rollback spend for cron rule ${ruleId}:`, rbErr?.message)
      );
    }
    console.error(`[Processor] ✗ Cron tx failed:`, err?.message);
    throw err;
  }
}


// ── Start workers ─────────────────────────────────────────────────────────

export function startWorkers() {
  const connection = getConnectionOptions();

  const paymentWorker = new Worker<PaymentJobData>(PAYMENT_QUEUE_NAME, processPaymentJob, {
    connection,
    concurrency: 5,
  });

  const cronWorker = new Worker<CronJobData>(CRON_QUEUE_NAME, processCronJob, {
    connection,
    concurrency: 2,
  });

  paymentWorker.on("completed", (job, result) => {
    console.log(`[Worker] ✓ Payment job ${job.id} done:`, JSON.stringify(result));
  });

  paymentWorker.on("failed", (job, err) => {
    console.error(`[Worker] ✗ Payment job ${job?.id} failed:`, err.message);
  });

  cronWorker.on("failed", (job, err) => {
    console.error(`[Worker] ✗ Cron job ${job?.id} failed:`, err.message);
  });

  console.log("[Worker] 🚀 BullMQ workers started (payment + cron)");

  return { paymentWorker, cronWorker };
}
