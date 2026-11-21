// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { fetchRecentPayments } from "../lib/engine";
import { processPaymentDirect } from "../engine/processor";
import { getHorizon } from "../stellar/horizon";
import { buildPage, parseDateRange, parsePagination } from "../lib/pagination";

export default async function autopilotRoutes(server: FastifyInstance) {
  
  // Status endpoint (protected)
  server.get("/status", { preHandler: [verifyAuth] }, async (request: any, reply: any) => {
    const sql = getDb();
    const query = request.query as any;
    const pagination = parsePagination(query, { defaultLimit: 5, maxLimit: 50 });
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });
    const range = parseDateRange(query);
    if (!range.ok) return reply.status(400).send({ error: range.error });
    
    const [txRows, ruleRows, engineBalance] = await Promise.all([
      sql`
        SELECT * FROM "AutomatedTransaction"
        WHERE "userId" = ${request.user!.id}::uuid
          AND (${range.from}::timestamptz IS NULL OR "createdAt" >= ${range.from}::timestamptz)
          AND (${range.to}::timestamptz IS NULL OR "createdAt" <= ${range.to}::timestamptz)
          AND (${pagination.cursor?.createdAt ?? null}::timestamptz IS NULL OR
               ("createdAt", id) < (${pagination.cursor?.createdAt ?? null}::timestamptz, ${pagination.cursor?.id ?? null}::uuid))
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${pagination.limit + 1}
        OFFSET ${pagination.offset}
      `,
      sql`
        SELECT COUNT(*) as count FROM "Rule"
        WHERE "userId" = ${request.user!.id}::uuid AND status = 'active'
      `,
      getHorizon()
        .accounts()
        .accountId(process.env.AUTOPILOT_PUBLIC_KEY!)
        .call()
        .then((acc: any) => {
          const native = acc.balances?.find((b: any) => b.asset_type === "native");
          return native?.balance ?? "0";
        })
        .catch(() => "N/A"),
    ]);

    const transactionPage = buildPage(txRows as any[], pagination);
    return reply.send({
      enginePublicKey: process.env.AUTOPILOT_PUBLIC_KEY,
      engineBalance,
      activeRules: Number(ruleRows[0]?.count ?? 0),
      recentTransactions: transactionPage.items,
      transactionPagination: transactionPage.pagination,
    });
  });

  // Monitor endpoint (supports both background worker with engine secret and authenticated user session)
  server.post("/monitor", async (request: any, reply: any) => {
    const ENGINE_SECRET = process.env.ENGINE_SECRET ?? process.env.JWT_SECRET;
    const authHeader = request.headers["x-engine-secret"];
    const isEngineSecret = Boolean(ENGINE_SECRET && authHeader === ENGINE_SECRET);

    let targetUserId: string | null = null;

    if (!isEngineSecret) {
      try {
        await request.jwtVerify();
        targetUserId = request.user?.id ?? null;
      } catch {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!targetUserId) {
        return reply.status(401).send({ error: "Unauthorized: Missing user session" });
      }
    } else if (request.body?.userId) {
      targetUserId = request.body.userId;
    }

    const sql = getDb();

    try {
      // Tenant isolation: if triggered by user session, only process that user's rules
      const users = await sql`
        SELECT DISTINCT u.id, u."publicKey", u."dailyLimit", u."weeklyLimit"
        FROM "User" u
        INNER JOIN "Rule" r ON r."userId" = u.id
        WHERE r.status = 'active'
          AND (${targetUserId}::uuid IS NULL OR u.id = ${targetUserId}::uuid)
      `;

      const results: any[] = [];
      let totalExecuted = 0;

      for (const user of users) {
        const payments = await fetchRecentPayments(user.publicKey, 10);

        for (const payment of payments) {
          const outcome = await processPaymentDirect({
            userId: user.id,
            publicKey: user.publicKey,
            paymentHorizonId: payment.id,
            amount: payment.amount,
            asset: payment.asset || "XLM",
            from: payment.from,
            timestamp: payment.createdAt || new Date().toISOString(),
          });

          if (outcome.results && outcome.results.length > 0) {
            for (const r of outcome.results) {
              results.push({
                userId: user.id,
                publicKey: user.publicKey,
                paymentId: payment.id,
                ...r,
              });
              if (r.status === "executed") {
                totalExecuted++;
              }
            }
          }
        }
      }

      return reply.send({
        ok: true,
        processed: totalExecuted,
        usersChecked: users.length,
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Engine] Monitor error:", message);
      return reply.status(500).send({ ok: false, error: message });
    }
  });

  server.get("/monitor", async (request: any, reply: any) => {
    if (process.env.NODE_ENV !== "development") {
      return reply.status(403).send({ error: "Not allowed" });
    }
    return reply.status(405).send({ error: "Use POST" });
  });
}
