/**
 * Soroban RPC Contract Event Ingest & Indexer
 *
 * Polls the Soroban RPC endpoint for contract events emitted by user vaults.
 * Ingests:
 *   - "init": Vault initialized on-chain
 *   - "withdraw": User wallet withdrawal
 *   - "execute": Engine rule-based execution
 *
 * Automatically:
 *   1. Reconciles live vault balances in the database
 *   2. Logs activity in AutomatedTransaction (deduplicated by txHash)
 *   3. Persists cursor (latestSyncedLedger) in Redis/DB for resilient restarts
 */

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { SOROBAN_RPC_URL, VAULT_CONTRACT_ID } from "../config/network";
import { getDb } from "../lib/db";
import { saveSorobanLedger, getSorobanLedger } from "../lib/redis";
import { getVaultBalance } from "../stellar/vault";

export interface ParsedSorobanEvent {
  contractId: string;
  type: "init" | "withdraw" | "execute" | "unknown";
  data: any;
  txHash: string;
  ledger: number;
}

/**
 * Safely parse a raw Soroban RPC event into structured data.
 */
export function parseContractEvent(event: any): ParsedSorobanEvent {
  const contractId = event.contractId ?? "";
  const txHash = event.txHash ?? event.id ?? "";
  const ledger = event.ledger ?? 0;

  let topic0 = "";
  try {
    if (Array.isArray(event.topic) && event.topic.length > 0) {
      const rawT0 = event.topic[0];
      const nativeT0 = typeof rawT0 === "string" ? rawT0 : scValToNative(rawT0);
      topic0 = String(nativeT0).toLowerCase();
    }
  } catch {
    topic0 = "";
  }

  let nativeVal: any = null;
  try {
    if (Array.isArray(event.value)) {
      nativeVal = event.value;
    } else if (event.value) {
      nativeVal = typeof event.value === "string" && !event.value.startsWith("A")
        ? event.value
        : scValToNative(event.value);
    }
  } catch {
    nativeVal = event.value ?? null;
  }

  if (topic0.includes("withdraw")) {
    const owner = Array.isArray(nativeVal) ? nativeVal[0] : nativeVal?.owner ?? null;
    const rawAmount = Array.isArray(nativeVal) ? nativeVal[1] : nativeVal?.amount ?? 0;
    const tokenAddress = Array.isArray(nativeVal) ? nativeVal[2] : nativeVal?.token_address ?? null;

    return {
      contractId,
      type: "withdraw",
      data: { owner, rawAmount, tokenAddress },
      txHash,
      ledger,
    };
  }

  if (topic0.includes("execute")) {
    const recipient = Array.isArray(nativeVal) ? nativeVal[0] : nativeVal?.recipient ?? null;
    const rawAmount = Array.isArray(nativeVal) ? nativeVal[1] : nativeVal?.amount ?? 0;
    const tokenAddress = Array.isArray(nativeVal) ? nativeVal[2] : nativeVal?.token_address ?? null;
    const memo = Array.isArray(nativeVal) ? nativeVal[3] : nativeVal?.memo ?? "";

    return {
      contractId,
      type: "execute",
      data: { recipient, rawAmount, tokenAddress, memo: String(memo) },
      txHash,
      ledger,
    };
  }

  if (topic0.includes("init")) {
    const owner = Array.isArray(nativeVal) ? nativeVal[0] : nativeVal?.owner ?? null;
    const engine = Array.isArray(nativeVal) ? nativeVal[1] : nativeVal?.engine ?? null;

    return {
      contractId,
      type: "init",
      data: { owner, engine },
      txHash,
      ledger,
    };
  }

  return {
    contractId,
    type: "unknown",
    data: nativeVal,
    txHash,
    ledger,
  };
}

/**
 * Format raw stroop amount (e.g. 10000000n -> "1.0000000")
 */
function formatStroopAmount(raw: any): string {
  if (raw === null || raw === undefined) return "0.0000000";
  const num = typeof raw === "bigint" ? Number(raw) : Number(raw);
  const units = num / 10000000;
  return units.toFixed(7);
}

/**
 * Perform a single poll cycle across registered Soroban contracts.
 */
export async function pollSorobanEventsOnce(
  server: rpc.Server,
  sql: any,
  contractIds: string[],
  startLedger: number
): Promise<{ eventsProcessed: number; latestLedger: number }> {
  if (contractIds.length === 0) {
    return { eventsProcessed: 0, latestLedger: startLedger };
  }

  let response: any;
  try {
    response = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds,
        },
      ],
      limit: 100,
    });
  } catch (err: any) {
    console.warn(`[SorobanEvents] ⚠ Failed to getEvents at ledger ${startLedger}:`, err?.message);
    return { eventsProcessed: 0, latestLedger: startLedger };
  }

  const rawEvents = response?.events ?? [];
  const latestLedger = response?.latestLedger ?? startLedger;

  if (rawEvents.length === 0) {
    return { eventsProcessed: 0, latestLedger };
  }

  let processedCount = 0;

  for (const raw of rawEvents) {
    const parsed = parseContractEvent(raw);
    if (parsed.type === "unknown") continue;

    console.log(
      `[SorobanEvents] 📡 Ingested event "${parsed.type}" for ${parsed.contractId.slice(0, 8)}… (tx: ${parsed.txHash.slice(0, 16)}…)`
    );

    // Find linked vault in database
    const vaultRows = await sql`
      SELECT id, "userId", type, "publicKey"
      FROM "Vault"
      WHERE "publicKey" = ${parsed.contractId}
      LIMIT 1
    `;

    if (vaultRows.length === 0) {
      console.log(`[SorobanEvents] Contract ${parsed.contractId.slice(0, 8)} not linked to a user vault — skipping DB record`);
      continue;
    }

    const vault = vaultRows[0];
    const amountStr = formatStroopAmount(parsed.data.rawAmount);
    const asset = "XLM"; // default native token SAC
    const memoText = parsed.data.memo ?? `Soroban ${parsed.type}`;

    // 1. Log activity in AutomatedTransaction (idempotent on txHash)
    if (parsed.type === "withdraw" || parsed.type === "execute") {
      try {
        await sql`
          INSERT INTO "AutomatedTransaction"
            (id, "userId", amount, type, asset, memo, "txHash", "createdAt")
          VALUES
            (gen_random_uuid(), ${vault.userId}::uuid, ${amountStr}, ${parsed.type}, ${asset}, ${memoText}, ${parsed.txHash}, NOW())
          ON CONFLICT ("txHash") DO NOTHING
        `;
      } catch (insertErr: any) {
        console.warn(`[SorobanEvents] ⚠ Failed to insert AutomatedTransaction for tx ${parsed.txHash}:`, insertErr?.message);
      }
    }

    // 2. Reconcile on-chain balance in Vault record
    try {
      const balance = await getVaultBalance(vault.publicKey);
      await sql`
        UPDATE "Vault"
        SET
          "xlmBalance" = ${balance.xlm.toFixed(7)},
          "usdcBalance" = ${balance.usdc.toFixed(7)},
          "updatedAt" = NOW()
        WHERE id = ${vault.id}::uuid
      `;
      console.log(`[SorobanEvents] ⚖ Reconciled balance for vault ${vault.publicKey.slice(0, 8)}… (${balance.xlm} XLM, ${balance.usdc} USDC)`);
    } catch (balErr: any) {
      console.warn(`[SorobanEvents] ⚠ Failed to reconcile balance for ${vault.publicKey}:`, balErr?.message);
    }

    processedCount++;
  }

  return { eventsProcessed: processedCount, latestLedger };
}

/**
 * Start the Soroban event listener poller service.
 */
export async function startSorobanEventListener(): Promise<() => void> {
  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
  const sql = getDb();

  console.log(`[SorobanEvents] 🚀 Starting Soroban contract event poller (${SOROBAN_RPC_URL})…`);

  let isRunning = true;
  let currentLedger: number | null = await getSorobanLedger("global");

  if (!currentLedger) {
    try {
      const latest = await server.getLatestLedger();
      currentLedger = Math.max(1, (latest.sequence ?? 0) - 10);
    } catch {
      currentLedger = 1;
    }
  }

  const pollInterval = setInterval(async () => {
    if (!isRunning) return;

    try {
      // Query all deployed smart contract vaults
      const contractVaults = await sql`
        SELECT DISTINCT "publicKey" FROM "Vault"
        WHERE "publicKey" LIKE 'C%'
      `;

      const contractIds: string[] = contractVaults.map((v: any) => v.publicKey);
      if (VAULT_CONTRACT_ID && !contractIds.includes(VAULT_CONTRACT_ID)) {
        contractIds.push(VAULT_CONTRACT_ID);
      }

      if (contractIds.length === 0) return;

      const result = await pollSorobanEventsOnce(server, sql, contractIds, currentLedger!);
      if (result.latestLedger > currentLedger!) {
        currentLedger = result.latestLedger;
        await saveSorobanLedger("global", currentLedger).catch(() => {});
      }
    } catch (err: any) {
      console.error("[SorobanEvents] ✗ Poller error:", err?.message);
    }
  }, 5000);

  return () => {
    isRunning = false;
    clearInterval(pollInterval);
    console.log("[SorobanEvents] 🛑 Soroban event poller stopped");
  };
}
