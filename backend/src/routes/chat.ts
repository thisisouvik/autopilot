// @ts-nocheck
import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { normalizeRuleAsset } from "../lib/ruleAsset";
import { getDb } from "../lib/db";
import { buildAiContext, computeActivityStats, buildRuleContext } from "../lib/insights";
import Groq from "groq-sdk";

/**
 * Load the aggregates the model needs to give personalised advice.
 *
 * Failures are non-fatal: if the query errors the route still answers, just
 * without personalisation, rather than breaking rule creation.
 */
async function loadUserContext(userId: string): Promise<{ activity: string; rules: string }> {
  try {
    const sql = getDb();
    const [txRows, ruleRows] = await Promise.all([
      sql`
        SELECT amount, type, "createdAt"
        FROM   "AutomatedTransaction"
        WHERE  "userId" = ${userId}::uuid
          AND  "createdAt" > NOW() - INTERVAL '90 days'
        ORDER  BY "createdAt" DESC
        LIMIT  500
      `,
      sql`
        SELECT trigger, action, amount, "isPercentage", status
        FROM   "Rule"
        WHERE  "userId" = ${userId}::uuid
        ORDER  BY "createdAt" DESC
        LIMIT  50
      `,
    ]);

    return {
      activity: buildAiContext(computeActivityStats(txRows as any[])),
      rules: buildRuleContext(ruleRows as any[]),
    };
  } catch (err) {
    console.error("Failed to load user context for chat:", err);
    return {
      activity: "Transaction history is unavailable for this request.",
      rules: "Rule configuration is unavailable for this request.",
    };
  }
}

export default async function chatRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.post("/", async (request: any, reply: any) => {
    const { message } = request.body as { message: string };

    if (typeof message !== "string" || message.trim().length === 0) {
      return reply.status(400).send({ error: "A message is required." });
    }

    if (!process.env.GROQ_API_KEY) {
      return reply.status(500).send({ error: "GROQ_API_KEY is not configured on the server." });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { activity, rules } = await loadUserContext(request.user!.id);

    const systemPrompt = `You are a financial automation assistant for a Stellar wallet.
The user will describe a rule they want to create. Extract the intent and return
a JSON object representing the rule.

The user's real automation activity (aggregated from their transaction history):
${activity}

The user's configured rules:
${rules}

Decide which of two things the user is asking for.

1. They want to CREATE OR CHANGE an automation rule. Return:
{
  "kind": "rule",
  "trigger": "short phrase for when the rule runs (e.g. 'on every payment received')",
  "action": "save | invest | buffer",
  "amount": number (the value to move),
  "isPercentage": boolean (true if amount is a %),
  "asset": "XLM | USDC",
  "description": "A short summary of what this rule does",
  "memo": "A short memo for the stellar transaction (max 28 chars)"
}

Asset rules — these matter, the engine routes real funds on them:
- Two assets are supported: XLM (the native asset) and USDC (the stable asset).
- Set "asset" to USDC only when the user clearly means USDC (they say "USDC",
  "dollars", "stablecoin", or "stable"). Otherwise set it to "XLM".
- The "trigger" MUST name the asset it applies to, because the engine matches
  incoming payments against the trigger text:
    * USDC rule  → "on every USDC payment received"
    * XLM rule   → "on every XLM payment received"
    * Either     → "on every payment received"   (omit the asset name)
- Use the asset-agnostic form only when the user genuinely wants the rule to
  fire on any incoming asset.
- Never name one asset in "trigger" while setting "asset" to the other.

Examples:
"save 10% of every payment"        → trigger "on every payment received",      asset "XLM"
"save 20 USDC from my salary"      → trigger "on every USDC payment received", asset "USDC"
"invest 5% of incoming XLM"        → trigger "on every XLM payment received",  asset "XLM"
"put 50 dollars aside each month"  → trigger "monthly",                        asset "USDC"`;

    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        // Advice replies need more headroom than a bare rule object.
        max_tokens: 512,
        response_format: { type: "json_object" },
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) throw new Error("No response from AI");

      const parsed = JSON.parse(responseText);

      // The model can emit an asset that contradicts its own trigger text.
      // Reconcile them here so the matcher and the executor agree.
      const { asset, trigger, corrected } = normalizeRuleAsset(parsed);
      if (corrected) {
        console.warn(
          `[Chat] Reconciled rule asset → ${asset} (trigger: "${trigger}", model said "${parsed.asset}")`,
        );
      }

      return reply.send({ rule: { ...parsed, asset, trigger } });
    } catch (err: any) {
      console.error("AI Error:", err);
      return reply.status(500).send({ error: "Failed to parse rule intent via AI." });
    }
  });
}
