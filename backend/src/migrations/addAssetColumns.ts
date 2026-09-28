// @ts-nocheck
/**
 * migrations/addAssetColumns.ts
 *
 * Adds asset tracking so USDC automation is distinguishable from XLM:
 *
 *   AutomatedTransaction.asset  — which asset the engine actually moved
 *   Goal.asset                  — the currency a goal's target is denominated in
 *
 * Both default to 'XLM', which is correct for every existing row: until this
 * migration the engine only ever recorded XLM-denominated executions, so
 * backfilling 'XLM' preserves history rather than guessing.
 *
 * Run: npm run migrate:asset
 */

import { getDb } from "../lib/db";
import dotenv from "dotenv";

dotenv.config();

/** Assets the engine can execute against — keep in sync with SupportedAsset. */
const SUPPORTED = ["XLM", "USDC"] as const;

async function run() {
  console.log("Running migration: AddAssetColumns...");
  const sql = getDb();

  try {
    // ── 1. AutomatedTransaction.asset ────────────────────────────────────
    console.log("1. Adding asset column to AutomatedTransaction...");
    await sql`
      ALTER TABLE "AutomatedTransaction"
      ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'XLM'
    `;

    // ── 2. Goal.asset ───────────────────────────────────────────────────
    console.log("2. Adding asset column to Goal...");
    await sql`
      ALTER TABLE "Goal"
      ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'XLM'
    `;

    // ── 3. Constrain both to supported assets ───────────────────────────
    // A typo'd asset code would silently break balance aggregation, so the
    // database rejects anything the engine cannot actually move. Added
    // separately from the column so re-running the migration is safe.
    // Identifiers cannot be parameterised, and the neon tagged template binds
    // every interpolation as a value — so these are written out literally
    // rather than looped over table names.
    console.log("3. Adding asset CHECK constraints...");

    // Postgres has no ADD CONSTRAINT IF NOT EXISTS, so drop then re-add to
    // keep the migration idempotent.
    await sql`
      ALTER TABLE "AutomatedTransaction"
      DROP CONSTRAINT IF EXISTS "atx_asset_supported"
    `;
    await sql`
      ALTER TABLE "AutomatedTransaction"
      ADD CONSTRAINT "atx_asset_supported" CHECK (asset IN ('XLM', 'USDC'))
    `;

    await sql`
      ALTER TABLE "Goal"
      DROP CONSTRAINT IF EXISTS "goal_asset_supported"
    `;
    await sql`
      ALTER TABLE "Goal"
      ADD CONSTRAINT "goal_asset_supported" CHECK (asset IN ('XLM', 'USDC'))
    `;

    // ── 4. Index for per-asset aggregation ──────────────────────────────
    console.log("4. Indexing (userId, asset) for per-asset totals...");
    await sql`
      CREATE INDEX IF NOT EXISTS "atx_user_asset_idx"
      ON "AutomatedTransaction" ("userId", asset)
    `;

    console.log(`\n✅ Asset columns ready (supported: ${SUPPORTED.join(", ")})`);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

run();
