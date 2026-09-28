// @ts-nocheck
/**
 * stellar/horizon.ts
 *
 * Horizon API wrapper:
 *  - Fetch full account details (balances, sequence number)
 *  - Get XLM + USDC balances formatted
 *  - Fetch recent payments for an account
 *  - Submit a signed transaction envelope
 */

import { Horizon, Asset } from "@stellar/stellar-sdk";
import {
  HORIZON_URL as CONFIG_HORIZON_URL,
  NETWORK_PASSPHRASE as CONFIG_NETWORK_PASSPHRASE,
  IS_TESTNET as CONFIG_IS_TESTNET,
  USDC_CODE,
  USDC_ISSUER,
  explorerUrl as configExplorerUrl,
} from "../config/network";

// ── Config ────────────────────────────────────────────────────────────────
// Every network-dependent value is resolved in config/network.ts. These are
// re-exported so existing importers of this module keep working unchanged.

export const HORIZON_URL = CONFIG_HORIZON_URL;

// Hard cap on how long a single Horizon read (e.g. fetching a large account's
// payment history) may take. Horizon can be slow for accounts with very large
// payment datasets; without a bound this can hang a request until the caller
// times out (issue #2). Failing fast with a clear error is better than dropping.
export const HORIZON_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Rejects `promise` if it does not settle within `ms`, with a clear timeout
 * error. Otherwise resolves/rejects with the original result.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Horizon request timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const NETWORK_PASSPHRASE = CONFIG_NETWORK_PASSPHRASE;

export const IS_TESTNET = CONFIG_IS_TESTNET;

/** USDC asset for the active network — issuer resolved in config/network.ts. */
export const USDC_ASSET = new Asset(USDC_CODE, USDC_ISSUER);

export const XLM_ASSET = Asset.native();

// ── Horizon server singleton ──────────────────────────────────────────────

let _server: Horizon.Server | null = null;

export function getHorizon(): Horizon.Server {
  if (!_server) _server = new Horizon.Server(HORIZON_URL);
  return _server;
}

// ── Account operations ────────────────────────────────────────────────────

export interface AccountBalance {
  asset: string;        // "XLM" or "USDC" or "TOKEN:ISSUER"
  balance: string;      // decimal string e.g. "100.0000000"
  isNative: boolean;
}

/**
 * Fetch all balances for an account.
 * Returns empty array if account is unfunded (404).
 */
export async function fetchAccountBalances(
  publicKey: string
): Promise<AccountBalance[]> {
  try {
    const account = await getHorizon().accounts().accountId(publicKey).call();

    return account.balances.map((b: any) => ({
      asset: b.asset_type === "native" ? "XLM" : `${b.asset_code}:${b.asset_issuer}`,
      balance: b.balance,
      isNative: b.asset_type === "native",
    }));
  } catch (err: any) {
    if (err?.response?.status === 404) return []; // Unfunded account
    throw err;
  }
}

/** Get just the XLM balance as a number. Returns 0 for unfunded accounts. */
export async function fetchXLMBalance(publicKey: string): Promise<number> {
  const balances = await fetchAccountBalances(publicKey);
  const xlm = balances.find((b) => b.isNative);
  return xlm ? parseFloat(xlm.balance) : 0;
}

/** Get just the USDC balance as a number. Returns 0 if no trustline or unfunded. */
export async function fetchUSDCBalance(publicKey: string): Promise<number> {
  const balances = await fetchAccountBalances(publicKey);
  const usdc = balances.find((b) => b.asset.startsWith("USDC:"));
  return usdc ? parseFloat(usdc.balance) : 0;
}

/** Load a full AccountResponse (needed for building transactions). */
export async function loadAccount(publicKey: string) {
  return getHorizon().loadAccount(publicKey);
}

/** Check if an account exists and is funded. */
export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await getHorizon().accounts().accountId(publicKey).call();
    return true;
  } catch (err: any) {
    if (err?.response?.status === 404) return false;
    throw err;
  }
}

// ── Payment history ───────────────────────────────────────────────────────

export interface StellarPayment {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  createdAt: string;
  pagingToken: string;
  transactionHash: string;
}

/**
 * Fetch the N most recent incoming payments for an account.
 * Filters to only payments WHERE `to === accountId`.
 */
export async function fetchRecentPayments(
  accountId: string,
  limit = 20
): Promise<StellarPayment[]> {
  try {
    const records = await withTimeout(
      getHorizon()
        .payments()
        .forAccount(accountId)
        .order("desc")
        .limit(limit)
        .call(),
      HORIZON_REQUEST_TIMEOUT_MS
    );

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
        pagingToken: r.paging_token,
        transactionHash: r.transaction_hash,
      }));
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throw err;
  }
}

/** Submit a signed transaction XDR to Horizon. Returns the tx hash. */
export async function submitTransaction(
  transaction: Parameters<Horizon.Server["submitTransaction"]>[0]
): Promise<string> {
  const result = await getHorizon().submitTransaction(transaction);
  return result.hash;
}

/** Generate an explorer URL for a tx or account (useful in DB records). */
export function explorerUrl(type: "tx" | "account", id: string): string {
  return configExplorerUrl(type, id);
}
