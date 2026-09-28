// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";
import { normalizeRuleAsset } from "../lib/ruleAsset";
import { buildPage, parsePagination, readConfiguredLimit } from "../lib/pagination";

const DEFAULT_MAX_RULES_PER_USER = 20;

export default async function rulesRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request: any, reply: any) => {
    const sql = getDb();
    const pagination = parsePagination(request.query as any);
    if (!pagination.ok) return reply.status(400).send({ error: pagination.error });

    const rules = pagination.cursor
      ? await sql`
          SELECT * FROM "Rule"
          WHERE "userId" = ${request.user!.id}::uuid
            AND ("createdAt", id) < (${pagination.cursor.createdAt}::timestamptz, ${pagination.cursor.id}::uuid)
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
        `
      : await sql`
          SELECT * FROM "Rule"
          WHERE "userId" = ${request.user!.id}::uuid
          ORDER BY "createdAt" DESC, id DESC
          LIMIT ${pagination.limit + 1}
          OFFSET ${pagination.offset}
        `;
    const page = buildPage(rules as any[], pagination);
    return reply.send({ rules: page.items, pagination: page.pagination });
  });

  server.post("/", async (request: any, reply: any) => {
    const body = request.body as any;
    const sql = getDb();
    const maxRules = readConfiguredLimit("MAX_RULES_PER_USER", DEFAULT_MAX_RULES_PER_USER);

    const countRows = await sql`
      SELECT COUNT(*) AS count FROM "Rule"
      WHERE "userId" = ${request.user!.id}::uuid
    `;
    if (Number(countRows[0]?.count ?? 0) >= maxRules) {
      return reply.status(409).send({
        error: `Rule limit reached. Each user can create up to ${maxRules} rules.`,
        code: "RULE_LIMIT_REACHED",
        limit: maxRules,
      });
    }

    // The asset a rule acts on is carried in its trigger text, which is what
    // the payment matcher reads. Normalise so a declared `asset` and the
    // trigger can never disagree — see lib/ruleAsset.ts.
    const { trigger } = normalizeRuleAsset(body);

    const result = await sql`
      INSERT INTO "Rule" (
        id, "userId", trigger, action, amount, "isPercentage", limits, status, memo, description, "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        ${request.user!.id}::uuid,
        ${trigger},
        ${body.action},
        ${body.amount},
        ${body.isPercentage ?? false},
        ${body.limits ? JSON.stringify(body.limits) : null}::jsonb,
        ${body.status ?? "active"},
        ${body.memo ?? null},
        ${body.description ?? null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return reply.send(result[0]);
  });

  server.patch("/:id", async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const sql = getDb();

    // Verify ownership
    const rules = await sql`SELECT id FROM "Rule" WHERE id = ${id}::uuid AND "userId" = ${request.user!.id}::uuid`;
    if (rules.length === 0) {
      return reply.status(404).send({ error: "Rule not found" });
    }

    if (body.status === "active") {
      const maxRules = readConfiguredLimit("MAX_RULES_PER_USER", DEFAULT_MAX_RULES_PER_USER);
      const activeRows = await sql`
        SELECT COUNT(*) AS count FROM "Rule"
        WHERE "userId" = ${request.user!.id}::uuid
          AND status = 'active'
          AND id <> ${id}::uuid
      `;
      if (Number(activeRows[0]?.count ?? 0) >= maxRules) {
        return reply.status(409).send({
          error: `Active rule limit reached. Each user can activate up to ${maxRules} rules.`,
          code: "RULE_LIMIT_REACHED",
          limit: maxRules,
        });
      }
    }

    const result = await sql`
      UPDATE "Rule"
      SET 
        status = CASE WHEN ${body.status !== undefined} THEN ${body.status} ELSE status END,
        "updatedAt" = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return reply.send(result[0]);
  });

  server.delete("/:id", async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const sql = getDb();

    const rules = await sql`SELECT id FROM "Rule" WHERE id = ${id}::uuid AND "userId" = ${request.user!.id}::uuid`;
    if (rules.length === 0) {
      return reply.status(404).send({ error: "Rule not found" });
    }

    await sql`DELETE FROM "Rule" WHERE id = ${id}::uuid`;
    return reply.send({ success: true });
  });
}
