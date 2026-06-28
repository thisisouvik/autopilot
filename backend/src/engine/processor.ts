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

  // Broad match — catches AI-generated trigger phrases like:
  // "when I receive XLM", "on any incoming payment", "salary received", etc.
  const matchesTrigger =
    t.includes("every payment") ||
    t.includes("payment received") ||
    t.includes("payment") ||
    t.includes("receive") ||
    t.includes("received") ||
    t.includes("incoming") ||
    t.includes("deposit") ||
    t.includes("salary") ||
    t.includes("income") ||
    t.includes("transfer") ||
    t.includes("xlm");

  return matchesTrigger && isXLM;
}

async function processPaymentJob(job: Job<PaymentJobData>) {
  const { userId, publicKey, paymentHorizonId, amount, asset } = job.data;
  const sql = getDb();

  console.log(`[Processor] ⚡ Job ${job.id} — ${amount} ${asset} for ${publicKey.slice(0, 8)}…`);

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

  console.log(`[Processor] 📋 Found ${rules.length} active rule(s) for user ${userId.slice(0, 8)}…`);

  if (rules.length === 0) {
    console.log(`[Processor] ℹ No active rules — nothing to do`);
    return { skipped: true, reason: "no_rules" };
  }

  const user = userRows[0];
  const dailyLimit = user.dailyLimit ? parseFloat(user.dailyLimit) : null;
  const weeklyLimit = user.weeklyLimit ? parseFloat(user.weeklyLimit) : null;
  const paymentAmountXLM = parseFloat(amount);

  // ── Step 3: Fetch user's vaults for routing
  const vaults = await sql`
    SELECT type, "publicKey", "encryptedSecret" FROM "Vault"
    WHERE "userId" = ${userId}::uuid
  `;
  const savingsVault  = vaults.find((v: any) => v.type === "savings");
  const investVault   = vaults.find((v: any) => v.type === "investment");

  const results: any[] = [];

  // ── Step 4: Match + execute each matching rule
  for (const rule of rules) {
    const triggerMatches = doesPaymentMatchTrigger(rule.trigger as string, asset);
    console.log(`[Processor] 🔍 Rule "${rule.trigger}" | matches: ${triggerMatches}`);
    if (!triggerMatches) continue;

    // ── Calculate execution amount
    const execAmount = (rule.isPercentage as boolean)
      ? (parseFloat(rule.amount) / 100) * paymentAmountXLM
      : parseFloat(rule.amount);

    console.log(`[Processor] 💰 Exec amount: ${execAmount} XLM (${rule.isPercentage ? `${rule.amount}%` : "flat"} of ${paymentAmountXLM})`);

    if (execAmount <= 0.0000001) { console.log("[Processor] ⚠ Exec amount too small — skipping"); continue; }
    if (execAmount > paymentAmountXLM) {
      console.log(`[Processor] ⚠ Rule ${rule.id} amount ${execAmount} > payment ${paymentAmountXLM} — skipping`);
      continue;
    }

    const execAmountStr = execAmount.toFixed(7);

    // ── Step 5: Spending limit check (Redis)
    const { allowed, reason } = await checkSpendingLimit(userId, execAmount, dailyLimit, weeklyLimit);
    if (!allowed) {
      console.log(`[Processor] 🚫 Limit guard blocked rule ${rule.id}: ${reason}`);
      results.push({ ruleId: rule.id, status: "blocked", reason });
      continue;
    }

    // ── Step 6: Determine destination based on rule action
    const action = (rule.action as string).toLowerCase();
    let destination: string | null = null;

    if (action.includes("save") || action.includes("saving")) {
      destination = savingsVault?.publicKey ?? null;
    } else if (action.includes("invest") || action.includes("investment")) {
      destination = investVault?.publicKey ?? null;
    }

    // Fallback: if no vault exists, skip execution
    if (!destination) {
      console.warn(`[Processor] ⚠ No ${action} vault found for user — skipping execution. User must create a Vault first.`);
      results.push({ ruleId: rule.id, status: "failed", error: "No vault found" });
      continue;
    }

    const memo = (rule.memo as string | null) ?? `AutoPilot:${action}:${execAmountStr}`.slice(0, 28);

    console.log(`[Processor] 🚀 Sending ${execAmountStr} XLM → ${destination.slice(0, 8)}… (${action})`);

    try {
      const txHash = await executeRuleTransaction(destination, execAmountStr, memo);

      // ── Step 7: Record in DB
      await sql`
        INSERT INTO "AutomatedTransaction"
          (id, "userId", "ruleId", amount, type, memo, "txHash", "createdAt")
        VALUES
          (gen_random_uuid(), ${userId}::uuid, ${rule.id}::uuid,
           ${execAmount}, ${action},
           ${memo}, ${txHash}, NOW())
      `;

      // ── Step 8: Update Redis spend counters
      await recordSpend(userId, execAmount);

      console.log(`[Processor] ✅ Rule "${rule.action}" | ${execAmountStr} XLM → vault | tx: ${txHash.slice(0, 20)}…`);
      results.push({ ruleId: rule.id, status: "executed", txHash, amount: execAmountStr, destination });

    } catch (txErr: any) {
      console.error(`[Processor] ✗ Tx failed for rule ${rule.id}:`, txErr?.message ?? txErr);
      results.push({ ruleId: rule.id, status: "failed", error: txErr?.message });
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
