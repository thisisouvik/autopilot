import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";

export default async function accountRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request, reply) => {
    const sql = getDb();
    
    const [userRows, ruleCount, txRows] = await Promise.all([
      sql`SELECT * FROM "User" WHERE id = ${request.user!.id}::uuid LIMIT 1`,
      sql`SELECT COUNT(*) AS count FROM "Rule" WHERE "userId" = ${request.user!.id}::uuid AND status = 'active'`,
      sql`
        SELECT * FROM "AutomatedTransaction"
        WHERE "userId" = ${request.user!.id}::uuid
        ORDER BY "createdAt" DESC
        LIMIT 100
      `,
    ]);

    const u = userRows[0];
    if (!u) {
      // Session token is valid but the user row is missing (e.g. DB reset or
      // a stale cookie). Return 401 so the client re-authenticates instead of
      // crashing on a null dereference of `u.publicKey` below.
      return reply.status(401).send({ error: "User not found. Please sign in again." });
    }

    return reply.send({
      publicKey: u.publicKey,
      dailyLimit: u.dailyLimit ?? null,
      weeklyLimit: u.weeklyLimit ?? null,
      plan: u.plan ?? "free",
      activeRules: Number(ruleCount[0]?.count ?? 0),
      transactions: txRows,
    });
  });

  server.patch("/", async (request, reply) => {
    const body = request.body as any;
    const sql = getDb();

    await sql`
      UPDATE "User"
      SET
        "dailyLimit"  = CASE WHEN ${body.dailyLimit  !== undefined} THEN ${body.dailyLimit  ?? null} ELSE "dailyLimit"  END,
        "weeklyLimit" = CASE WHEN ${body.weeklyLimit !== undefined} THEN ${body.weeklyLimit ?? null} ELSE "weeklyLimit" END,
        "plan"        = CASE WHEN ${body.plan        !== undefined} THEN ${body.plan        ?? 'free'} ELSE "plan"    END,
        "updatedAt"   = NOW()
      WHERE id = ${request.user!.id}::uuid
    `;

    return reply.send({ success: true });
  });
}
