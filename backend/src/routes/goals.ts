// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { parseRuleAsset } from "../lib/ruleAsset";
import { buildPage, parsePagination, readConfiguredLimit } from "../lib/pagination";

const DEFAULT_MAX_GOALS_PER_USER = 50;

export default async function goalsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request: any, reply: any) => {
    const sql = getDb();
    const pagination = parsePagination(request.query as any);
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });

    const goals = pagination.cursor
      ? await sql`
          SELECT * FROM "Goal"
          WHERE "userId" = ${request.user!.id}::uuid
            AND ("createdAt", id) < (${pagination.cursor.createdAt}::timestamptz, ${pagination.cursor.id}::uuid)
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
        `
      : await sql`
          SELECT * FROM "Goal"
          WHERE "userId" = ${request.user!.id}::uuid
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
          OFFSET ${pagination.offset}
        `;
    const page = buildPage(goals as any[], pagination);
    return reply.send({ goals: page.items, pagination: page.pagination });
  });

  server.post("/", async (request: any, reply: any) => {
    const body = request.body as any;
    const sql = getDb();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const targetAmount = parseFloat(body.targetAmount);

    if (!name || isNaN(targetAmount) || targetAmount <= 0) {
      return reply.status(400).send({ error: "Name and a positive target amount are required." });
    }

    if (name.length > 60) {
      return reply.status(400).send({ error: "Goal name must be 60 characters or fewer." });
    }


    const maxGoals = readConfiguredLimit("MAX_GOALS_PER_USER", DEFAULT_MAX_GOALS_PER_USER);
    const countRows = await sql`
      SELECT COUNT(*) AS count FROM "Goal"
      WHERE "userId" = ${request.user!.id}::uuid
    `;
    if (Number(countRows[0]?.count ?? 0) >= maxGoals) {
      return reply.status(409).send({
        error: `Goal limit reached. Each user can create up to ${maxGoals} goals.`,
        code: "GOAL_LIMIT_REACHED",
        limit: maxGoals,
      });
    }

    // Goals are denominated in a single asset. Rejecting an unsupported value
    // rather than defaulting keeps a typo from creating an XLM goal the user
    // believes is in USDC. The DB CHECK constraint is the backstop.
    const asset = parseRuleAsset(body.asset ?? "XLM");
    if (!asset) {
      return reply.status(400).send({ error: "asset must be either XLM or USDC" });
    }

    const result = await sql`
      INSERT INTO "Goal" (
        "userId", name, "targetAmount", "currentAmount", emoji, asset
      )
      VALUES (
        ${request.user!.id}::uuid,
        ${body.name},
        ${body.targetAmount},
        0,
        ${body.emoji || "🎯"},
        ${asset}
      )
      RETURNING *
    `;

    return reply.send({ success: true, goal: result[0] });
  });

  server.patch("/:id", async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const sql = getDb();

    // Verify ownership
    const existing = await sql`SELECT id FROM "Goal" WHERE id = ${id}::uuid AND "userId" = ${request.user!.id}::uuid`;
    if (existing.length === 0) {
      return reply.status(404).send({ error: "Goal not found" });
    }

    const result = await sql`
      UPDATE "Goal"
      SET 
        "linkedRuleId" = CASE WHEN ${body.linkedRuleId !== undefined} THEN ${body.linkedRuleId ?? null}::uuid ELSE "linkedRuleId" END,
        "currentAmount" = CASE WHEN ${body.currentAmount !== undefined} THEN ${body.currentAmount ?? 0} ELSE "currentAmount" END,
        "updatedAt" = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return reply.send({ success: true, goal: result[0] });
  });

  server.delete("/:id", async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const sql = getDb();

    const result = await sql`
      DELETE FROM "Goal" 
      WHERE id = ${id}::uuid AND "userId" = ${request.user!.id}::uuid
      RETURNING id
    `;

    if (result.length === 0) {
      return reply.status(404).send({ error: "Goal not found" });
    }

    return reply.send({ success: true });
  });
}
