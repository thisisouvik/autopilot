/**
 * routes/vault.ts
 *
 * REST API for user vaults:
 *
 * GET    /api/vault           → list user's vaults (savings + investment)
 * POST   /api/vault/:type     → create a vault (type: savings | investment)
 * GET    /api/vault/:type/balance → live on-chain balance
 * POST   /api/vault/:type/withdraw → withdraw funds back to wallet
 * DELETE /api/vault/:type     → close vault (merge XLM back to wallet)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import {
  createVaultOnChain,
  getVaultBalance,
  prepareWithdrawTransaction,
  submitSignedWithdrawTransaction,
  closeVault,
  VaultType,
} from "../stellar/vault";
import { explorerUrl, NETWORK_LABEL } from "../config/network";
import { buildPage, parsePagination } from "../lib/pagination";

export interface AuthUser {
  id: string;
  publicKey: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export type AuthRequest<
  RouteGeneric extends {
    Params?: any;
    Querystring?: any;
    Body?: any;
  } = {}
> = FastifyRequest<RouteGeneric> & { user: AuthUser };

const VALID_TYPES: VaultType[] = ["savings", "investment"];

export default async function vaultRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  // ── List all vaults ───────────────────────────────────────────────────

  server.get<{ Querystring: Record<string, string | undefined> }>("/", async (request, reply) => {
    const sql = getDb();
    const pagination = parsePagination(request.query as any, { defaultLimit: 20, maxLimit: 50 });
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });

    const vaults = pagination.cursor
      ? await sql`
          SELECT id, type, "publicKey", "xlmBalance", "usdcBalance", "fundTxHash", "createdAt"
          FROM "Vault"
          WHERE "userId" = ${request.user.id}::uuid
            AND ("createdAt", id) < (${pagination.cursor.createdAt}::timestamptz, ${pagination.cursor.id}::uuid)
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
        `
      : await sql`
          SELECT id, type, "publicKey", "xlmBalance", "usdcBalance", "fundTxHash", "createdAt"
          FROM "Vault"
          WHERE "userId" = ${request.user.id}::uuid
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
          OFFSET ${pagination.offset}
        `;
    const page = buildPage(vaults as any[], pagination);
    return reply.send({ vaults: page.items, pagination: page.pagination });
  });

  // ── Create a vault ────────────────────────────────────────────────────

  server.post<{ Params: { type: string } }>("/:type", async (request, reply) => {
    const { type } = request.params as { type: string };

    if (!VALID_TYPES.includes(type as VaultType)) {
      return reply.status(400).send({
        error: `Invalid vault type. Must be one of: ${VALID_TYPES.join(", ")}`,
      });
    }

    const sql = getDb();

    // Check if vault already exists
    const existing = await sql`
      SELECT id, "publicKey" FROM "Vault"
      WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return reply.status(409).send({
        error: `A ${type} vault already exists for this account.`,
        vault: existing[0],
      });
    }

    // Check engine account is funded (needs ~2.5 XLM to create a vault)
    const { fetchXLMBalance } = await import("../stellar/horizon");
    const engineBalance = await fetchXLMBalance(process.env.AUTOPILOT_PUBLIC_KEY!);
    if (engineBalance < 3) {
      return reply.status(503).send({
        error:
          `Engine account needs at least 3 XLM to create a vault (current: ${engineBalance.toFixed(2)} XLM). ` +
          `Fund the engine at: ${process.env.AUTOPILOT_PUBLIC_KEY}`,
      });
    }

    try {
      const { publicKey, encryptedSecret, fundTxHash } = await createVaultOnChain(
        request.user.id,
        type as VaultType,
        request.user.publicKey
      );

      const inserted = await sql`
        INSERT INTO "Vault"
          (id, "userId", type, "publicKey", "encryptedSecret", "fundTxHash", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), ${request.user.id}::uuid, ${type},
           ${publicKey}, ${encryptedSecret ?? null}, ${fundTxHash}, NOW(), NOW())
        RETURNING id, type, "publicKey", "fundTxHash", "createdAt"
      `;

      const expType = publicKey.startsWith("C") ? "contract" : "account";

      return reply.status(201).send({
        message: `${type} vault created on Stellar ${NETWORK_LABEL} (Non-custodial Soroban Vault)`,
        vault: inserted[0],
        fundTxHash,
        explorerUrl: explorerUrl(expType, publicKey),
      });
    } catch (err: any) {
      console.error("[Vault] ✗ Failed to create %s vault:", type, err?.message);
      return reply.status(500).send({
        error: `Failed to create vault: ${err?.message ?? "Unknown error"}`,
      });
    }
  });

  // ── Get live balance ──────────────────────────────────────────────────

  server.get<{ Params: { type: string } }>("/:type/balance", async (request, reply) => {
    const { type } = request.params as { type: string };
    const sql = getDb();

    const vaults = await sql`
      SELECT "publicKey" FROM "Vault"
      WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      LIMIT 1
    `;

    if (vaults.length === 0) {
      return reply.status(404).send({ error: `No ${type} vault found. Create one first.` });
    }

    try {
      const balance = await getVaultBalance(vaults[0].publicKey as string);

      // Cache the balance in DB (best-effort)
      await sql`
        UPDATE "Vault"
        SET "xlmBalance" = ${balance.xlm.toFixed(7)},
            "usdcBalance" = ${balance.usdc.toFixed(7)},
            "updatedAt" = NOW()
        WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      `;

      return reply.send({
        type,
        publicKey: vaults[0].publicKey,
        xlm: balance.xlm,
        usdc: balance.usdc,
        isActive: balance.isActive,
        explorerUrl: balance.explorerUrl,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message });
    }
  });

  // ── Withdraw from vault ───────────────────────────────────────────────

  // ── Prepare withdrawal (Soroban non-custodial wallet sign flow) ───────

  server.post<{
    Params: { type: string };
    Body: { asset?: "xlm" | "usdc"; amount: string };
  }>("/:type/withdraw/prepare", async (request, reply) => {
    const { type } = request.params as { type: string };
    const { asset = "xlm", amount } = (request.body ?? {}) as {
      asset?: "xlm" | "usdc";
      amount: string;
    };

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return reply.status(400).send({ error: "amount is required and must be a positive number" });
    }

    const sql = getDb();
    const vaults = await sql`
      SELECT "publicKey" FROM "Vault"
      WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      LIMIT 1
    `;

    if (vaults.length === 0) {
      return reply.status(404).send({ error: `No ${type} vault found.` });
    }

    try {
      const prepared = await prepareWithdrawTransaction(
        vaults[0].publicKey as string,
        request.user.publicKey,
        asset,
        parseFloat(amount).toFixed(7)
      );

      return reply.send({
        success: true,
        type,
        asset,
        amount,
        unsignedTxXdr: prepared.unsignedTxXdr,
        networkPassphrase: prepared.networkPassphrase,
        contractId: prepared.contractId,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message });
    }
  });

  // ── Execute/Submit withdrawal (Requires Web3 wallet cryptographic signature) ──

  server.post<{
    Params: { type: string };
    Body?: { signedTxXdr?: string };
  }>("/:type/withdraw", async (request, reply) => {
    const { type } = request.params as { type: string };
    const { signedTxXdr } = (request.body ?? {}) as {
      signedTxXdr?: string;
    };

    const sql = getDb();
    const vaults = await sql`
      SELECT "publicKey", "encryptedSecret" FROM "Vault"
      WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      LIMIT 1
    `;

    if (vaults.length === 0) {
      return reply.status(404).send({ error: `No ${type} vault found.` });
    }

    // Web3 cryptographic authorization: submit the user's wallet-signed transaction
    if (signedTxXdr) {
      try {
        const txHash = await submitSignedWithdrawTransaction(signedTxXdr);
        return reply.send({
          success: true,
          txHash,
          explorerUrl: explorerUrl("tx", txHash),
        });
      } catch (err: any) {
        return reply.status(500).send({ error: `Transaction submission failed: ${err?.message}` });
      }
    }

    // Unsigned withdrawals are strictly rejected to prevent session hijacking and Web2 bypass
    return reply.status(400).send({
      error:
        "Cryptographic authorization required: Vault withdrawals must be signed using your connected Web3 wallet (Freighter). " +
        "Call /api/vault/:type/withdraw/prepare to prepare the unsigned transaction, sign with Freighter, and submit signedTxXdr.",
      requiresSignature: true,
    });
  });

  // ── Close vault ───────────────────────────────────────────────────────

  server.delete<{ Params: { type: string } }>("/:type", async (request, reply) => {
    const { type } = request.params as { type: string };

    if (!VALID_TYPES.includes(type as VaultType)) {
      return reply.status(400).send({
        error: `Invalid vault type. Must be one of: ${VALID_TYPES.join(", ")}`,
      });
    }

    const sql = getDb();

    const vaults = await sql`
      SELECT id, "publicKey", "encryptedSecret" FROM "Vault"
      WHERE "userId" = ${request.user.id}::uuid AND type = ${type}
      LIMIT 1
    `;

    if (vaults.length === 0) {
      return reply.status(404).send({ error: `No ${type} vault found.` });
    }

    const vault = vaults[0];

    // For non-custodial Soroban smart contracts, closing must be signed by the owner
    if (!vault.encryptedSecret) {
      return reply.status(400).send({
        error:
          "Vault is non-custodial (Soroban smart contract). Closing or draining vault must be initiated and signed by your Web3 wallet.",
        isNonCustodial: true,
        contractId: vault.publicKey,
      });
    }

    try {
      const txHash = await closeVault(
        vault.encryptedSecret as string,
        request.user.publicKey
      );

      await sql`DELETE FROM "Vault" WHERE id = ${vault.id}::uuid`;

      return reply.send({
        success: true,
        message: `${type} vault closed. All funds returned to your wallet.`,
        txHash,
      });
    } catch (err: any) {
      // A missing trustline on the user's wallet is a user-fixable condition,
      // not a server fault — surface it as a 400 with the actionable message.
      if (err?.message?.includes("Cannot close vault")) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(500).send({ error: err?.message });
    }
  });
}
