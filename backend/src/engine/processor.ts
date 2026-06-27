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
 */

import { Worker, Job } from "bullmq";
import { getDb } from "../lib/db";
import { executeRuleTransaction } from "../lib/engine";
import { checkSpendingLimit, recordSpend } from "./limitGuard";
import { PAYMENT_QUEUE_NAME, PaymentJobData, CronJobData, CRON_QUEUE_NAME, getConnectionOptions } from "./queue";

// ── Helpers ───────────────────────────────────────────────────────────────

function doesPaymentMatchTrigger(trigger: string, asset: string): boolean {
  const t = trigger.toLowerCase();
  const isXLM = asset === "XLM";
  return (
    t.includes("every payment") ||
    t.includes("payment received") ||
    t.includes("receive") ||
    t.includes("incoming") ||
    t.includes("deposit")
  ) && isXLM;
}

async function processPaymentJob(job: Job<PaymentJobData>) {
  const { userId, publicKey, paymentHorizonId, amount, asset } = job.data;
  const sql = getDb();

  console.log(`[Processor] ⚡ Job ${job.id} — payment ${paymentHorizonId.slice(0, 16)}… for ${publicKey.slice(0, 8)}…`);

  // ── Step 1: Check for duplicate processing
  const existing = await sql`
    SELECT 1 FROM "AutomatedTransaction"
    WHERE "txHash" = ${paymentHorizonId}
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`[Processor] ⏭ Already processed ${paymentHorizonId.slice(0, 16)}… — skipping`);
    return { skipped: true, reason: "duplicate" };
  }

  // ── Step 2: Fetch user data + active rules
  const [userRows, rules] = await Promise.all([
    sql`SELECT id, "dailyLimit", "weeklyLimit" FROM "User" WHERE id = ${userId}::uuid LIMIT 1`,
    sql`
      SELECT * FROM "Rule"
      WHERE "userId" = ${userId}::uuid AND status = 'active'
      ORDER BY "createdAt" ASC
    `,
  ]);

  if (userRows.length === 0) {
    console.warn(`[Processor] ⚠ User ${userId} not found`);
    return { skipped: true, reason: "user_not_found" };
  }

  const user = userRows[0];
  const dailyLimit = user.dailyLimit ? parseFloat(user.dailyLimit) : null;
  const weeklyLimit = user.weeklyLimit ? parseFloat(user.weeklyLimit) : null;
  const paymentAmountXLM = parseFloat(amount);

  const results: any[] = [];

  // ── Step 3: Match + execute each matching rule
  for (const rule of rules) {
    if (!doesPaymentMatchTrigger(rule.trigger as string, asset)) continue;

    // ── Calculate execution amount
    const execAmount = (rule.isPercentage as boolean)
      ? (parseFloat(rule.amount) / 100) * paymentAmountXLM
      : parseFloat(rule.amount);

    // Guard: amount must be positive and not exceed payment
    if (execAmount <= 0.0000001) continue;
    if (execAmount > paymentAmountXLM) {
      console.log(`[Processor] ⚠ Rule ${rule.id} amount ${execAmount} > payment ${paymentAmountXLM} — skipping`);
      continue;
    }

    const execAmountStr = execAmount.toFixed(7);

    // ── Step 4: Spending limit check (Redis)
    const { allowed, reason } = await checkSpendingLimit(userId, execAmount, dailyLimit, weeklyLimit);
    if (!allowed) {
      console.log(`[Processor] 🚫 Limit guard blocked rule ${rule.id}: ${reason}`);
      results.push({ ruleId: rule.id, status: "blocked", reason });
      continue;
    }

    // ── Step 5: Build + submit Stellar transaction
    const destination = process.env.AUTOPILOT_PUBLIC_KEY!;
    const memo = (rule.memo as string | null) ?? `AutoPilot:${rule.action}:${execAmountStr}`.slice(0, 28);

    try {
      const txHash = await executeRuleTransaction(destination, execAmountStr, memo);

      // ── Step 6: Record in DB
      await sql`
        INSERT INTO "AutomatedTransaction"
          (id, "userId", "ruleId", amount, type, memo, "txHash", "createdAt")
        VALUES
          (gen_random_uuid(), ${userId}::uuid, ${rule.id}::uuid,
           ${execAmount}, ${(rule.action as string).toLowerCase()},
           ${memo}, ${paymentHorizonId}, NOW())
      `;

      // ── Step 7: Update Redis spend counters
      await recordSpend(userId, execAmount);

      console.log(`[Processor] ✅ Rule "${rule.action}" | ${execAmountStr} XLM | tx: ${txHash.slice(0, 20)}…`);
      results.push({ ruleId: rule.id, status: "executed", txHash, amount: execAmountStr });

    } catch (txErr: any) {
      console.error(`[Processor] ✗ Tx failed for rule ${rule.id}:`, txErr?.message ?? txErr);
      results.push({ ruleId: rule.id, status: "failed", error: txErr?.message });
      // Don't throw — we want to process remaining rules even if one fails
    }
  }

  return { processed: results.length, results };
}

async function processCronJob(job: Job<CronJobData>) {
  const { userId, ruleId, amount, isPercentage, action, memo } = job.data;
  const sql = getDb();

  console.log(`[Processor] ⏰ Cron job for rule ${ruleId}`);

  // For cron rules, the amount is always a flat value (not percentage)
  const execAmount = amount;
  if (execAmount <= 0) return { skipped: true, reason: "zero_amount" };

  // Check limits
  const userRows = await sql`
    SELECT id, "dailyLimit", "weeklyLimit" FROM "User" WHERE id = ${userId}::uuid LIMIT 1
  `;
  if (userRows.length === 0) return { skipped: true, reason: "user_not_found" };

  const user = userRows[0];
  const { allowed, reason } = await checkSpendingLimit(
    userId,
    execAmount,
    user.dailyLimit ? parseFloat(user.dailyLimit) : null,
    user.weeklyLimit ? parseFloat(user.weeklyLimit) : null
  );

  if (!allowed) {
    console.log(`[Processor] 🚫 Cron rule ${ruleId} blocked: ${reason}`);
    return { status: "blocked", reason };
  }

  const destination = process.env.AUTOPILOT_PUBLIC_KEY!;
  const memoText = (memo ?? `AutoPilot:${action}:${execAmount}`).slice(0, 28);
  const execAmountStr = execAmount.toFixed(7);

  try {
    const txHash = await executeRuleTransaction(destination, execAmountStr, memoText);

    await sql`
      INSERT INTO "AutomatedTransaction"
        (id, "userId", "ruleId", amount, type, memo, "txHash", "createdAt")
      VALUES
        (gen_random_uuid(), ${userId}::uuid, ${ruleId}::uuid,
         ${execAmount}, ${action.toLowerCase()}, ${memoText}, ${txHash}, NOW())
    `;

    await recordSpend(userId, execAmount);
    console.log(`[Processor] ✅ Cron rule "${action}" | ${execAmountStr} XLM | tx: ${txHash.slice(0, 20)}…`);
    return { status: "executed", txHash, amount: execAmountStr };
  } catch (err: any) {
    console.error(`[Processor] ✗ Cron tx failed:`, err?.message);
    throw err; // Rethrow so BullMQ retries
  }
}

// ── Start workers ─────────────────────────────────────────────────────────

export function startWorkers() {
  const connection = getConnectionOptions();

  const paymentWorker = new Worker<PaymentJobData>(
    PAYMENT_QUEUE_NAME,
    processPaymentJob,
    {
      connection,
      concurrency: 5,
    }
  );

  const cronWorker = new Worker<CronJobData>(
    CRON_QUEUE_NAME,
    processCronJob,
    {
      connection,
      concurrency: 2,
    }
  );

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
