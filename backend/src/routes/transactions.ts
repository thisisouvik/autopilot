// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { buildPage, parseDateRange, parsePagination } from "../lib/pagination";

export default async function transactionsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request: any, reply: any) => {
    const sql = getDb();
    const query = request.query as any;
    const pagination = parsePagination(query);
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });
    const range = parseDateRange(query);
    if (!range.ok) return reply.status(400).send({ error: range.error });

    const txRows = await sql`
      SELECT * FROM "AutomatedTransaction"
      WHERE "userId" = ${request.user!.id}::uuid
        AND (${range.from}::timestamptz IS NULL OR "createdAt" >= ${range.from}::timestamptz)
        AND (${range.to}::timestamptz IS NULL OR "createdAt" <= ${range.to}::timestamptz)
        AND (${pagination.cursor?.createdAt ?? null}::timestamptz IS NULL OR
             ("createdAt", id) < (${pagination.cursor?.createdAt ?? null}::timestamptz, ${pagination.cursor?.id ?? null}::uuid))
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${pagination.limit + 1}
      OFFSET ${pagination.offset}
    `;
    const page = buildPage(txRows as any[], pagination);
    return reply.send({ transactions: page.items, pagination: page.pagination });
  });
}
