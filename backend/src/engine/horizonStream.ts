/**
 * Horizon SSE Stream Listener
 *
 * Opens a real-time payment stream for each active wallet.
 * When a payment arrives:
 *   1. Save cursor to Redis (for resume on restart)
 *   2. Add a PaymentJob to BullMQ
 *
 * Stream management:
 *   - Polls DB every 60s for new wallets with active rules
 *   - Opens one stream per unique public key
 *   - Cleans up streams for wallets with no active rules
 *   - Resumes from the last saved cursor on restart
 */

import { horizonServer } from "../lib/engine";
import { saveHorizonCursor, getHorizonCursor } from "../lib/redis";
import { getPaymentQueue, PaymentJobData } from "./queue";
import { getDb } from "../lib/db";

interface StreamHandle {
  close: () => void;
}

const activeStreams = new Map<string, StreamHandle>(); // publicKey → close fn

// ── Open a single wallet stream ───────────────────────────────────────────

async function openStream(userId: string, publicKey: string) {
  if (activeStreams.has(publicKey)) return; // Already watching

  // Resume from last cursor if available
  const cursor = (await getHorizonCursor(publicKey)) ?? "now";

  console.log(`[Stream] 👀 Watching ${publicKey.slice(0, 8)}… (cursor: ${cursor})`);

  let closeHandle: (() => void) | null = null;

  try {
    // stellar-sdk stream returns a close function
    const closeFn = horizonServer
      .payments()
      .forAccount(publicKey)
      .cursor(cursor)
      .stream({
        onmessage: async (record: any) => {
          // We only care about incoming payments (type === "payment" and to === publicKey)
          if (record.type !== "payment") return;
          if (record.to !== publicKey) return;

          const asset = record.asset_type === "native"
            ? "XLM"
            : `${record.asset_code}:${record.asset_issuer}`;

          console.log(
            `[Stream] 💸 Payment detected | ${record.amount} ${asset} → ${publicKey.slice(0, 8)}…`
          );

          // Save cursor so we can resume on restart
          await saveHorizonCursor(publicKey, record.paging_token);

          // Enqueue for processing
          const jobData: PaymentJobData = {
            userId,
            publicKey,
            paymentHorizonId: record.id,
            amount: record.amount,
            asset,
            from: record.from,
            createdAt: record.created_at,
          };

          await getPaymentQueue().add(
            `payment:${record.id}`,
            jobData,
            {
              jobId: record.id, // Ensures uniqueness — BullMQ won't add duplicates
            }
          );
        },
        onerror: (err: any) => {
          const msg = err?.message ?? String(err);
          // Ignore "Account not found" (unfunded testnet wallets)
          if (msg.includes("404") || msg.includes("Not Found")) return;
          console.error(`[Stream] ✗ Error on ${publicKey.slice(0, 8)}…:`, msg);
        },
      });

    closeHandle = closeFn as unknown as () => void;
    activeStreams.set(publicKey, { close: closeHandle });

  } catch (err: any) {
    // 404 = account not funded yet — silently skip
    if (err?.response?.status === 404 || err?.message?.includes("404")) return;
    console.error(`[Stream] ✗ Failed to open stream for ${publicKey.slice(0, 8)}…:`, err?.message);
  }
}

// ── Sync active streams with DB ───────────────────────────────────────────

async function syncStreams() {
  const sql = getDb();

  try {
    // Get all unique public keys that have at least one active rule
    const rows = await sql`
      SELECT DISTINCT u.id, u."publicKey"
      FROM "User" u
      INNER JOIN "Rule" r ON r."userId" = u.id
      WHERE r.status = 'active'
    `;

    const activeKeys = new Set(rows.map((r: any) => r.publicKey as string));

    // Open streams for new wallets
    for (const row of rows) {
      await openStream(row.id as string, row.publicKey as string);
    }

    // Close streams for wallets that no longer have active rules
    for (const [pk, handle] of activeStreams) {
      if (!activeKeys.has(pk)) {
        console.log(`[Stream] 🔕 Closing stream for ${pk.slice(0, 8)}… (no active rules)`);
        handle.close();
        activeStreams.delete(pk);
      }
    }

    if (rows.length > 0) {
      console.log(`[Stream] 📡 Watching ${activeStreams.size} wallet(s)`);
    }
  } catch (err: any) {
    console.error("[Stream] ✗ syncStreams error:", err?.message);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

export async function startHorizonStreams() {
  console.log("[Stream] 🌊 Starting Horizon SSE stream manager…");

  // Initial sync
  await syncStreams();

  // Re-sync every 60 seconds to pick up new wallets / paused rules
  const intervalId = setInterval(syncStreams, 60_000);

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
    for (const [pk, handle] of activeStreams) {
      handle.close();
      activeStreams.delete(pk);
    }
    console.log("[Stream] 🛑 All Horizon streams closed");
  };
}
