#!/usr/bin/env node
/**
 * AutoPilot Background Worker
 *
 * Runs alongside your Next.js dev server.
 * Polls /api/autopilot/monitor every 30 seconds.
 *
 * Usage:
 *   npx tsx worker.ts
 *
 * Keep this terminal open in the background while developing.
 *
 * How it works:
 *  1. Every POLL_INTERVAL_MS milliseconds, it calls the monitor endpoint
 *  2. The monitor checks all users' Stellar accounts for new incoming payments
 *  3. Matching rules are executed via on-chain Stellar transactions
 *  4. Results are logged here and recorded in the database
 *
 * For production: replace with a proper cron job or Vercel Cron.
 */

import * as dotenv from "dotenv";
import {
  fetchRecentPayments,
  executeRuleTransaction,
  isPaymentAlreadyProcessed,
  horizonServer,
} from "./src/lib/engine";
import { neon } from "@neondatabase/serverless";

dotenv.config();

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const APP_URL = process.env.WORKER_APP_URL ?? "http://localhost:3001";
const ENGINE_SECRET = process.env.ENGINE_SECRET ?? process.env.JWT_SECRET ?? "dev-engine-secret";

let iteration = 0;

async function poll() {
  iteration++;
  const now = new Date().toLocaleTimeString();
  process.stdout.write(`\r[${now}] AutoPilot worker — cycle #${iteration}…`);

  try {
    const res = await fetch(`${APP_URL}/api/autopilot/monitor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-engine-secret": ENGINE_SECRET,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`\n[Worker] ✗ Monitor returned ${res.status}: ${text}`);
      return;
    }

    const data = await res.json();

    if (data.processed > 0) {
      console.log(`\n[Worker] ✅ ${data.processed} rule(s) executed for ${data.usersChecked} user(s)`);
      for (const r of data.results ?? []) {
        if (r.status === "executed") {
          console.log(
            `  ↳ ${r.ruleAction} ${r.amount} XLM | user: ${r.publicKey.slice(0, 8)}… | tx: ${r.txHash?.slice(0, 20)}…`
          );
        } else {
          console.log(
            `  ↳ ✗ FAILED ${r.ruleAction} | user: ${r.publicKey.slice(0, 8)}… | ${r.error}`
          );
        }
      }
    }
  } catch (err: any) {
    if (err?.code === "ECONNREFUSED") {
      process.stdout.write(`\r[${now}] Waiting for Next.js server to start…     `);
    } else {
      console.error(`\n[Worker] ✗ Poll error:`, err?.message ?? err);
    }
  }
}

async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║     AutoPilot Background Worker v1.0      ║");
  console.log("╠═══════════════════════════════════════════╣");
  console.log(`║  App URL   : ${APP_URL.padEnd(29)}║`);
  console.log(`║  Interval  : ${String(POLL_INTERVAL_MS / 1000).padEnd(28)}s║`);
  console.log(`║  Network   : Stellar Testnet               ║`);
  console.log("╚═══════════════════════════════════════════╝");
  console.log();
  console.log("Worker started. Ctrl+C to stop.\n");

  // Run immediately then repeat
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch(console.error);
