// @ts-nocheck
/**
 * DB Migration: Add the one-time authentication challenge table.
 *
 * Run: npm run migrate:auth-challenge
 */

import dotenv from "dotenv";
import { getDb } from "../lib/db";

dotenv.config();

async function migrate() {
  const sql = getDb();

  console.log("Running migration: addAuthChallengeTable...");

  await sql`
    CREATE TABLE IF NOT EXISTS "AuthChallenge" (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      "publicKey" TEXT        NOT NULL,
      message     TEXT        NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS "auth_challenge_expires_idx"
    ON "AuthChallenge" ("expiresAt")
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS "auth_challenge_public_key_idx"
    ON "AuthChallenge" ("publicKey")
  `;

  console.log("✅ AuthChallenge table created successfully");
}

migrate().catch((error) => {
  console.error("❌ Migration failed:", error.message);
  process.exit(1);
});
