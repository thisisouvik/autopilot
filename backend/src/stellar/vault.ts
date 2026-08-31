/**
 * stellar/vault.ts
 *
 * Vault management — each user gets two server-controlled Stellar accounts:
 *   - savings vault  → receives auto-save rule executions
 *   - investment vault → receives auto-invest rule executions
 *
 * Vault lifecycle:
 *   1. generateVaultKeypair()  → create random keypair
 *   2. fundAndTrustlineVault() → fund with 2.5 XLM + add USDC trustline (1 tx)
 *   3. Store publicKey + encryptedSecret in DB
 *   4. All future rule executions target the vault's publicKey
 *
 * DB Table: "Vault"
 *   id, userId, type ('savings'|'investment'), publicKey, encryptedSecret,
 *   xlmBalance, usdcBalance, createdAt, updatedAt
 */

import { Asset, Keypair } from "@stellar/stellar-sdk";
import { generateVaultKeypair, loadKeypairFromBlob } from "./keypair";
import {
  fetchAccountBalances,
  fetchXLMBalance,
  fetchUSDCBalance,
  accountExists,
  explorerUrl,
  USDC_ASSET,
} from "./horizon";
import {
  fundAndTrustlineVault,
  createUSDCTrustline,
  sendXLM,
  sendUSDC,
  mergeAccount,
  closeAccountWithTrustlines,
} from "./transaction";

export type VaultType = "savings" | "investment";

export interface VaultRecord {
  id: string;
  userId: string;
  type: VaultType;
  publicKey: string;
  encryptedSecret: string;
  xlmBalance: string;
  usdcBalance: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultBalance {
  xlm: number;
  usdc: number;
  isActive: boolean;
  explorerUrl: string;
}

// ── Engine keypair helper ─────────────────────────────────────────────────

function getEngineKeypair(): typeof Keypair.prototype {
  const secret = process.env.AUTOPILOT_SECRET_KEY;
  if (!secret) throw new Error("AUTOPILOT_SECRET_KEY not set");
  return Keypair.fromSecret(secret);
}

// ── Vault creation ────────────────────────────────────────────────────────

/**
 * Create and activate a vault on-chain.
 *
 * 1. Generate a new random keypair
 * 2. Fund it + add USDC trustline in one atomic Stellar transaction
 * 3. Return the vault data ready to be inserted into DB
 *
 * NOTE: costs ~2.5 XLM from the engine account per vault.
 * On testnet, the engine account can be funded for free via friendbot.
 */
export async function createVaultOnChain(
  userId: string,
  type: VaultType
): Promise<{
  publicKey: string;
  encryptedSecret: string;
  fundTxHash: string;
}> {
  const engine = getEngineKeypair();
  const { publicKey, encryptedSecret } = generateVaultKeypair();
  const vaultSigner = loadKeypairFromBlob(encryptedSecret);

  const fundTxHash = await fundAndTrustlineVault(engine, vaultSigner);

  console.log(
    `[Vault] ✅ ${type} vault created for user ${userId.slice(0, 8)}…\n` +
    `       Public key: ${publicKey}\n` +
    `       Funded tx:  ${fundTxHash}`
  );

  return { publicKey, encryptedSecret, fundTxHash };
}

// ── Vault balance ─────────────────────────────────────────────────────────

/** Get live XLM + USDC balance for a vault */
export async function getVaultBalance(publicKey: string): Promise<VaultBalance> {
  const balances = await fetchAccountBalances(publicKey);
  const isActive = balances.length > 0;

  const xlmEntry = balances.find((b) => b.isNative);
  const usdcEntry = balances.find((b) => b.asset.startsWith("USDC:"));

  return {
    xlm: xlmEntry ? parseFloat(xlmEntry.balance) : 0,
    usdc: usdcEntry ? parseFloat(usdcEntry.balance) : 0,
    isActive,
    explorerUrl: explorerUrl("account", publicKey),
  };
}

// ── Vault deposits / withdrawals ──────────────────────────────────────────

/**
 * Deposit XLM into a user's vault.
 * Called by the rule processor when a rule fires.
 *
 * @param encryptedSecret  From DB (decrypted internally)
 * @param fromPublicKey    Engine or user source account
 * @param amountXLM        Amount to deposit
 * @param memo             Optional memo
 */
export async function depositXLMToVault(
  vaultPublicKey: string,
  amountXLM: string,
  memo?: string
): Promise<string> {
  const engine = getEngineKeypair();
  return sendXLM(engine, vaultPublicKey, amountXLM, memo ?? "AutoPilot save");
}

/**
 * Deposit USDC into a user's vault.
 */
export async function depositUSDCToVault(
  vaultPublicKey: string,
  amountUSDC: string,
  memo?: string
): Promise<string> {
  const engine = getEngineKeypair();
  return sendUSDC(engine, vaultPublicKey, amountUSDC, memo ?? "AutoPilot save");
}

/**
 * Withdraw XLM from a vault back to the user's wallet.
 *
 * @param encryptedSecret  Encrypted vault secret key from DB
 * @param toPublicKey      User's wallet address (G...)
 * @param amountXLM        Amount to withdraw (leave at least 1.5 XLM for reserve)
 */
export async function withdrawXLMFromVault(
  encryptedSecret: string,
  toPublicKey: string,
  amountXLM: string,
  memo?: string
): Promise<string> {
  const vaultSigner = loadKeypairFromBlob(encryptedSecret);
  return sendXLM(vaultSigner, toPublicKey, amountXLM, memo ?? "AutoPilot withdraw");
}

/**
 * Withdraw USDC from a vault back to the user's wallet.
 */
export async function withdrawUSDCFromVault(
  encryptedSecret: string,
  toPublicKey: string,
  amountUSDC: string,
  memo?: string
): Promise<string> {
  const vaultSigner = loadKeypairFromBlob(encryptedSecret);
  return sendUSDC(vaultSigner, toPublicKey, amountUSDC, memo ?? "AutoPilot withdraw");
}

/**
 * Close a vault — return every asset it holds, then merge the XLM back to the
 * user's wallet and delete the account.
 *
 * A vault is created with a USDC trustline, and Stellar refuses an
 * accountMerge while any trustline exists (op_has_sub_entries) — so the
 * trustline must be removed even when the USDC balance is zero. Any USDC
 * still held is paid back to the user first, in the same atomic transaction.
 *
 * Returning USDC requires the user's wallet to trust USDC. If it doesn't, the
 * payment would fail with op_no_trust and take the whole close down with it,
 * so that case is reported up front with an actionable message.
 */
export async function closeVault(
  encryptedSecret: string,
  toPublicKey: string
): Promise<string> {
  const vaultSigner = loadKeypairFromBlob(encryptedSecret);
  const vaultPublicKey = vaultSigner.publicKey();

  const balances = await fetchAccountBalances(vaultPublicKey);

  // Every non-native balance is a trustline that blocks the merge.
  const nonNative = balances.filter((b) => !b.isNative);

  if (nonNative.length === 0) {
    // No trustlines — a plain merge is enough.
    return mergeAccount(vaultSigner, toPublicKey);
  }

  const heldAssets = nonNative.map((b) => {
    const [code, issuer] = b.asset.split(":");
    return { asset: new Asset(code, issuer), balance: b.balance };
  });

  // Only assets with a balance actually need the destination to trust them.
  const assetsToReturn = heldAssets.filter((a) => parseFloat(a.balance) > 0);

  if (assetsToReturn.length > 0) {
    const destinationBalances = await fetchAccountBalances(toPublicKey);
    const missing = assetsToReturn
      .map((a) => a.asset)
      .filter(
        (asset) =>
          !destinationBalances.some(
            (b) => b.asset === `${asset.getCode()}:${asset.getIssuer()}`
          )
      );

    if (missing.length > 0) {
      const codes = missing.map((a) => a.getCode()).join(", ");
      throw new Error(
        `Cannot close vault: your wallet has no ${codes} trustline, so the ` +
          `vault's ${codes} balance cannot be returned. Add a ${codes} ` +
          `trustline to your wallet, or withdraw the ${codes} first, then close the vault.`
      );
    }
  }

  console.log(
    `[Vault] 🔒 Closing ${vaultPublicKey.slice(0, 8)}… — ` +
      `returning ${assetsToReturn.length} asset balance(s) and removing ` +
      `${heldAssets.length} trustline(s) before merge`
  );

  return closeAccountWithTrustlines(vaultSigner, toPublicKey, heldAssets);
}
