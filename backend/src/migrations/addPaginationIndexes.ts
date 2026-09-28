// @ts-nocheck
import dotenv from "dotenv";
import { getDb } from "../lib/db";

dotenv.config();

async function run() {
  const sql = getDb();

  await sql`
    CREATE INDEX IF NOT EXISTS "rule_user_created_id_idx"
    ON "Rule" ("userId", "createdAt" DESC, id DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "goal_user_created_id_idx"
    ON "Goal" ("userId", "createdAt" DESC, id DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "vault_user_created_id_idx"
    ON "Vault" ("userId", "createdAt" DESC, id DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "transaction_user_created_id_idx"
    ON "AutomatedTransaction" ("userId", "createdAt" DESC, id DESC)
  `;

  console.log("Pagination indexes created successfully");
}

run().catch((error) => {
  console.error("Pagination index migration failed:", error);
  process.exit(1);
});
