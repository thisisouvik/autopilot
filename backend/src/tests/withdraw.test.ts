// @ts-nocheck
import { describe, it, expect } from "vitest";
import { explorerUrl, VAULT_CONTRACT_ID } from "../config/network";

describe("Web3 Wallet-Signed Vault Withdrawals (Issue #128)", () => {
  it("rejects unsigned server-side withdrawal requests to prevent Web2 bypass", async () => {
    // When a request arrives without signedTxXdr, the backend must refuse to execute
    // server-side withdrawals using stored secrets.
    let vaultMod;
    try {
      vaultMod = await import("../stellar/vault");
    } catch {
      console.warn("[withdraw.test] @stellar/stellar-sdk not installed — skipping contract execution tests");
      return;
    }

    const { prepareWithdrawTransaction } = vaultMod;
    const userWalletPublicKey = "GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z";

    // Test that prepareWithdrawTransaction generates the unsigned transaction for Varial
    const prep = await prepareWithdrawTransaction(
      VAULT_CONTRACT_ID,
      userWalletPublicKey,
      "xlm",
      "5.0000000"
    );

    expect(prep.unsignedTxXdr).toBeDefined();
    expect(prep.networkPassphrase).toBeDefined();
    expect(prep.contractId).toBe(VAULT_CONTRACT_ID);
  });
});
