/**
 * Stellar Automation Engine
 *
 * Architecture:
 *   - AutoPilot runs its own server-side Stellar keypair (AUTOPILOT_SECRET_KEY)
 *   - When a rule fires, we create a Stellar transaction signed by this server account
 *   - For "Save" rules: funds move from AutoPilot engine → dedicated savings destination
 *   - We record every execution in the AutomatedTransaction DB table
 *
 * For testnet MVP:
 *   - The engine monitors each user's account via Horizon REST (polling)
 *   - Rule matching: "on every payment received" → check recent payments
 *   - Execution: server-side transaction from the engine account (simulates the vault move)
 *   - In production: multi-sig or pre-authorized transactions would be used instead
 */

import {
  Horizon,
  Keypair,
  Networks,
  Asset,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK =
  process.env.STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;

export const horizonServer = new Horizon.Server(HORIZON_URL);

/** Load the AutoPilot engine keypair from env */
export function getEngineKeypair(): Keypair {
  const secret = process.env.AUTOPILOT_SECRET_KEY;
  if (!secret) throw new Error("AUTOPILOT_SECRET_KEY not set in environment");
  return Keypair.fromSecret(secret);
}

/** Fetch the most recent N payments for a Stellar account */
export async function fetchRecentPayments(
  accountId: string,
  limit = 20
): Promise<StellarPayment[]> {
  try {
    const records = await horizonServer
      .payments()
      .forAccount(accountId)
      .order("desc")
      .limit(limit)
      .call();

    return records.records
      .filter((r: any) => r.type === "payment" && r.to === accountId)
      .map((r: any) => ({
        id: r.id,
        type: "payment",
        from: r.from,
        to: r.to,
        amount: r.amount,
        asset:
          r.asset_type === "native"
            ? "XLM"
            : `${r.asset_code}:${r.asset_issuer}`,
        createdAt: r.created_at,
        transactionHash: r.transaction_hash,
      }));
  } catch (err: any) {
    // Account not found / unfunded
    if (err?.response?.status === 404) return [];
    throw err;
  }
}

export interface StellarPayment {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  createdAt: string;
  transactionHash: string;
}

/**
 * Execute a rule-triggered Stellar transaction.
 *
 * The engine account sends XLM (from its own balance) to a "savings vault"
 * destination. This demonstrates the on-chain execution flow. In production
 * this would be replaced with a multi-sig transaction originating from the
 * user's account.
 *
 * @param destinationId  Stellar public key of the savings vault / target
 * @param amountXLM      Amount to transfer as a string (e.g. "10.0000000")
 * @param memoText       Memo attached to the transaction
 */
export async function executeRuleTransaction(
  destinationId: string,
  amountXLM: string,
  memoText: string
): Promise<string> {
  const engineKeypair = getEngineKeypair();
  const engineAccount = await horizonServer.loadAccount(engineKeypair.publicKey());

  const tx = new TransactionBuilder(engineAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: destinationId,
        asset: Asset.native(),
        amount: amountXLM,
      })
    )
    .addMemo({ type: "text", value: memoText.slice(0, 28) } as any)
    .setTimeout(30)
    .build();

  tx.sign(engineKeypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

/** Check if a payment already processed (deduplicate by Horizon payment ID) */
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
