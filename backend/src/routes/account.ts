// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { buildPage, parseDateRange, parsePagination } from "../lib/pagination";

export default async function accountRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request: any, reply: any) => {
    const sql = getDb();
    const query = request.query as any;
    const pagination = parsePagination(query);
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });
    const range = parseDateRange(query);
    if (!range.ok) return reply.status(400).send({ error: range.error });
    
    const [userRows, ruleCount, txRows] = await Promise.all([
      sql`SELECT * FROM "User" WHERE id = ${request.user!.id}::uuid LIMIT 1`,
      sql`SELECT COUNT(*) AS count FROM "Rule" WHERE "userId" = ${request.user!.id}::uuid AND status = 'active'`,
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
    ]);

    const u = userRows[0];
    if (!u) {
      // Session token is valid but the user row is missing (e.g. DB reset or
      // a stale cookie). Return 401 so the client re-authenticates instead of
      // crashing on a null dereference of `u.publicKey` below.
      return reply.status(401).send({ error: "User not found. Please sign in again." });
    }

    // Update lastSeen async
    sql`UPDATE "User" SET "lastSeen" = NOW() WHERE id = ${request.user!.id}::uuid`.catch(console.error);

    const transactionPage = buildPage(txRows as any[], pagination);

    return reply.send({
      publicKey: u.publicKey,
      lastSeen: u.lastSeen,
      dailyLimit: u.dailyLimit ?? null,
      weeklyLimit: u.weeklyLimit ?? null,
      plan: u.plan ?? "free",
      activeRules: Number(ruleCount[0]?.count ?? 0),
      transactions: transactionPage.items,
      transactionPagination: transactionPage.pagination,
    });
  });

  server.patch("/", async (request: any, reply: any) => {
    const body = request.body as any;
    const sql = getDb();

    let dailyLimit = body.dailyLimit;
    if (dailyLimit !== undefined && dailyLimit !== null) {
      const parsed = parseFloat(dailyLimit);
      if (isNaN(parsed) || parsed < 0) {
        return reply.status(400).send({ error: "dailyLimit must be a positive number or null" });
      }
      dailyLimit = parsed.toString();
    }

    let weeklyLimit = body.weeklyLimit;
    if (weeklyLimit !== undefined && weeklyLimit !== null) {
      const parsed = parseFloat(weeklyLimit);
      if (isNaN(parsed) || parsed < 0) {
        return reply.status(400).send({ error: "weeklyLimit must be a positive number or null" });
      }
      weeklyLimit = parsed.toString();
    }

    await sql`
      UPDATE "User"
      SET
        "dailyLimit"  = CASE WHEN ${body.dailyLimit  !== undefined} THEN ${dailyLimit} ELSE "dailyLimit"  END,
        "weeklyLimit" = CASE WHEN ${body.weeklyLimit !== undefined} THEN ${weeklyLimit} ELSE "weeklyLimit" END,
        "plan"        = CASE WHEN ${body.plan        !== undefined} THEN ${body.plan        ?? 'free'} ELSE "plan"    END,
        "updatedAt"   = NOW()
      WHERE id = ${request.user!.id}::uuid
    `;

    return reply.send({ success: true });
  });
}

