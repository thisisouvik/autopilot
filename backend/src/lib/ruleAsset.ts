// @ts-nocheck
/**
 * lib/ruleAsset.ts
 *
 * Reconciles the asset a rule declares with the asset its trigger text names.
 *
 * This matters because two different mechanisms read the asset:
 *   - the payment path matches an incoming payment against the TRIGGER text
 *     (doesPaymentMatchTrigger), and
 *   - the execution path moves funds using the stored ASSET column.
 *
 * If those disagree — an LLM emitting asset "USDC" with trigger "on every XLM
 * payment received" — a rule would match XLM payments and then try to send
 * USDC. Normalising once, server-side, keeps the two in step rather than
 * trusting the model to be self-consistent.
 */

export type RuleAsset = "XLM" | "USDC";

export interface NormalizedRuleAsset {
  asset: RuleAsset;
  trigger: string;
  /** True when the incoming pair disagreed and had to be reconciled. */
  corrected: boolean;
}

/**
 * Which asset a piece of text names.
 *
 * Returns "XLM" when the text names both, matching the payment matcher: a
 * trigger mentioning both assets is ambiguous, and XLM is the safer resolution
 * because it requires no trustline. Returns null only when neither is named.
 */
function namedAsset(text: string): RuleAsset | null {
  const t = text.toLowerCase();
  const xlm = t.includes("xlm");
  const usdc = t.includes("usdc");
  if (usdc && !xlm) return "USDC";
  if (xlm) return "XLM";
  return null;
}

/** Parse a declared asset field, tolerating case and common synonyms. */
export function parseRuleAsset(raw: unknown): RuleAsset | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "usdc" || v === "usd" || v === "dollars" || v === "stablecoin") return "USDC";
  if (v === "xlm" || v === "lumens" || v === "native") return "XLM";
  return null;
}

/**
 * Decide the definitive asset for a rule and make its trigger agree.
 *
 * Precedence: the trigger text wins when it explicitly names an asset, because
 * the trigger is what the payment matcher reads at execution time. Otherwise
 * the declared asset is used, and the trigger is rewritten to name it so the
 * matcher will actually fire for that asset.
 */
export function normalizeRuleAsset(input: {
  asset?: unknown;
  trigger?: unknown;
}): NormalizedRuleAsset {
  const trigger = typeof input.trigger === "string" ? input.trigger.trim() : "";
  const declared = parseRuleAsset(input.asset);
  const fromTrigger = namedAsset(trigger);

  // The trigger explicitly names an asset — it is authoritative.
  if (fromTrigger) {
    return {
      asset: fromTrigger,
      trigger,
      corrected: declared !== null && declared !== fromTrigger,
    };
  }

  // Trigger is asset-agnostic. A declared USDC rule needs the trigger to say
  // so, otherwise the matcher would fire it on XLM payments too.
  if (declared === "USDC") {
    return { asset: "USDC", trigger: injectAsset(trigger, "USDC"), corrected: true };
  }

  // Default: XLM. The trigger is left asset-agnostic so it still matches XLM
  // payments (the matcher treats an unqualified trigger as "any asset"), which
  // preserves the pre-existing behaviour of rules created before this change.
  return { asset: "XLM", trigger, corrected: false };
}

/**
 * Rewrite an asset-agnostic trigger to name `asset`.
 *
 * "on every payment received" → "on every USDC payment received"
 * Falls back to appending when no known phrase is present.
 */
function injectAsset(trigger: string, asset: RuleAsset): string {
  if (!trigger) return `on every ${asset} payment received`;

  // Insert before the first occurrence of "payment"/"deposit"/"transfer".
  const replaced = trigger.replace(
    /\b(payment|deposit|transfer)\b/i,
    (word) => `${asset} ${word}`,
  );
  if (replaced !== trigger) return replaced;

  // Time-based or unrecognised trigger ("monthly", "every friday"): append the
  // asset so the stored text still records which asset moves.
  return `${trigger} (${asset})`;
}
