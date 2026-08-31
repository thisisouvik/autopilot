/**
 * lib/engine.ts
 *
 * Thin bridge — re-exports Stellar utilities from src/stellar/
 * for backward compatibility with existing engine/ and routes/ code.
 *
 * All new code should import directly from src/stellar/*.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { sendXLM, sendUSDC } from "../stellar/transaction";

export { fetchRecentPayments } from "../stellar/horizon";
export { loadKeypairFromBlob } from "../stellar/keypair";

/** Engine server keypair — signs all automated transactions */
export function getEngineKeypair(): typeof Keypair.prototype {
  const secret = process.env.AUTOPILOT_SECRET_KEY;
  if (!secret) throw new Error("AUTOPILOT_SECRET_KEY not set in environment");
  return Keypair.fromSecret(secret);
}

/**
 * Execute an automated rule transaction.
 * Sends XLM or USDC from the engine account to a destination (vault or user wallet).
 *
 * The asset defaults to XLM so existing 3-argument callers keep working.
 * USDC requires a trustline on both the engine account and the destination —
 * vaults get one at creation time (see stellar/vault.ts).
 */
export async function executeRuleTransaction(
  destinationId: string,
  amount: string,
  memoText: string,
  asset: "XLM" | "USDC" = "XLM"
): Promise<string> {
  const engine = getEngineKeypair();
  return asset === "USDC"
    ? sendUSDC(engine, destinationId, amount, memoText)
    : sendXLM(engine, destinationId, amount, memoText);
}

/** Check if a Horizon payment ID has already been processed (deduplication) */
export async function isPaymentAlreadyProcessed(
  paymentHorizonId: string,
  sql: (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>
): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM "AutomatedTransaction"
    WHERE "txHash" = ${paymentHorizonId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export type { StellarPayment } from "../stellar/horizon";
