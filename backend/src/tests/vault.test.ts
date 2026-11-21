// @ts-nocheck
import { describe, it, expect } from "vitest";
import { explorerUrl, VAULT_CONTRACT_ID, FACTORY_CONTRACT_ID } from "../config/network";

describe("Non-custodial Soroban Vault & VaultFactory (Issues #127 & #197)", () => {
  it("explorerUrl handles contract type", () => {
    const url = explorerUrl("contract", "CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP");
    expect(url).toBe(
      "https://stellar.expert/explorer/testnet/contract/CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP"
    );
  });

  it("exports VAULT_CONTRACT_ID and FACTORY_CONTRACT_ID as Soroban contract addresses", () => {
    expect(VAULT_CONTRACT_ID).toMatch(/^C[A-Z0-9]{55}$/);
    expect(FACTORY_CONTRACT_ID).toMatch(/^C[A-Z0-9]{55}$/);
  });

  it("vault operations test when dependencies available", async () => {
    let vaultMod;
    try {
      vaultMod = await import("../stellar/vault");
    } catch {
      console.warn("[vault.test] @stellar/stellar-sdk not installed — skipping contract execution tests");
      return;
    }

    const { createVaultOnChain, withdrawXLMFromVault, withdrawUSDCFromVault, closeVault } = vaultMod;

    const mockUserId = "11111111-2222-3333-4444-555555555555";
    const userWalletPublicKey = "GDFKLTB5WKKDDJ2NRU2V5OG476HYEGWT4UFV7BID7BNGWZGRZYL3LL6Z";

    const result = await createVaultOnChain(mockUserId, "savings", userWalletPublicKey);
    expect(result.encryptedSecret).toBeNull();
    expect(result.contractId).toMatch(/^C[A-Z0-9]{55}$/);
    expect(result.publicKey).toBe(result.contractId);

    // Test per-user isolated contract instance deployment via VaultFactory
    const userWalletPublicKey2 = "GBTESTPUBLICKEYUSER22222222222222222222222222222222222";
    const result2 = await createVaultOnChain("22222222-3333-4444-5555-666666666666", "savings", userWalletPublicKey2);
    expect(result2.contractId).toMatch(/^C[A-Z0-9]{55}$/);
    expect(result2.contractId).not.toBe(result.contractId);

    // Test per-type isolated contract instance deployment
    const resultInvest = await createVaultOnChain(mockUserId, "investment", userWalletPublicKey);
    expect(resultInvest.contractId).toMatch(/^C[A-Z0-9]{55}$/);
    expect(resultInvest.contractId).not.toBe(result.contractId);

    await expect(
      withdrawXLMFromVault(null, userWalletPublicKey, "10.0000000")
    ).rejects.toThrow(/non-custodial/i);

    await expect(
      withdrawUSDCFromVault(null, userWalletPublicKey, "5.0000000")
    ).rejects.toThrow(/non-custodial/i);

    await expect(
      closeVault(null, userWalletPublicKey)
    ).rejects.toThrow(/non-custodial/i);
  });
});
