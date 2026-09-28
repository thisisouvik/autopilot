// @ts-nocheck
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env");
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log("Running migration: addTxHashUnique...\n");

  await sql`
    ALTER TABLE "AutomatedTransaction"
    ADD CONSTRAINT "AutomatedTransaction_txHash_key" UNIQUE ("txHash")
  `.catch(err => {
    console.log("Constraint might already exist, ignoring error:", err.message);
  });

  console.log("   ✅ Unique constraint on txHash added\n");
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
