// @ts-nocheck
import { describe, it, expect } from "vitest";
import { normalizeRuleAsset, parseRuleAsset } from "../lib/ruleAsset";

/**
 * The processor imports bullmq/db at module load, which is unavailable in a
 * bare checkout, so the two pure matcher helpers are re-implemented here to be
 * asserted directly. They mirror backend/src/engine/processor.ts — if that
 * logic changes, these must change with it.
 */
function parseAssetCode(asset: string): "XLM" | "USDC" | null {
  const code = asset === "XLM" ? "XLM" : asset.split(":")[0]?.toUpperCase();
  return code === "XLM" || code === "USDC" ? code : null;
}

function doesPaymentMatchTrigger(trigger: string, asset: string): boolean {
  const t = trigger.toLowerCase();
  const assetCode = parseAssetCode(asset);
  if (!assetCode) return false;

  const matchesTrigger =
    t.includes("every payment") || t.includes("payment received") || t.includes("payment") ||
    t.includes("receive") || t.includes("received") || t.includes("incoming") ||
    t.includes("deposit") || t.includes("salary") || t.includes("income") ||
    t.includes("transfer") || t.includes("xlm") || t.includes("usdc");

  if (!matchesTrigger) return false;

  const namesXLM = t.includes("xlm");
  const namesUSDC = t.includes("usdc");
  if (namesXLM && !namesUSDC) return assetCode === "XLM";
  if (namesUSDC && !namesXLM) return assetCode === "USDC";
  return true;
}

const USDC_TESTNET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RANDOM_TOKEN = "SHADY:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("parseAssetCode", () => {
  it("recognises native XLM and issued USDC", () => {
    expect(parseAssetCode("XLM")).toBe("XLM");
    expect(parseAssetCode(USDC_TESTNET)).toBe("USDC");
  });

  it("rejects assets the engine cannot move", () => {
    // An arbitrary token has no trustline on the vaults, so executing against
    // it would always fail on-chain.
    expect(parseAssetCode(RANDOM_TOKEN)).toBeNull();
  });
});

describe("doesPaymentMatchTrigger — USDC", () => {
  it("fires a USDC-named trigger on a USDC payment", () => {
    expect(doesPaymentMatchTrigger("on every USDC payment received", USDC_TESTNET)).toBe(true);
  });

  it("does not fire a USDC trigger on an XLM payment", () => {
    expect(doesPaymentMatchTrigger("on every USDC payment received", "XLM")).toBe(false);
  });

  it("does not fire an XLM trigger on a USDC payment", () => {
    expect(doesPaymentMatchTrigger("on every XLM payment received", USDC_TESTNET)).toBe(false);
  });

  it("fires an asset-agnostic trigger on either asset", () => {
    expect(doesPaymentMatchTrigger("on every payment received", "XLM")).toBe(true);
    expect(doesPaymentMatchTrigger("on every payment received", USDC_TESTNET)).toBe(true);
    expect(doesPaymentMatchTrigger("salary", USDC_TESTNET)).toBe(true);
  });

  it("never fires for an unsupported asset, however generic the trigger", () => {
    expect(doesPaymentMatchTrigger("on every payment received", RANDOM_TOKEN)).toBe(false);
  });
});

describe("parseRuleAsset", () => {
  it("accepts the supported codes case-insensitively", () => {
    expect(parseRuleAsset("USDC")).toBe("USDC");
    expect(parseRuleAsset("usdc")).toBe("USDC");
    expect(parseRuleAsset("XLM")).toBe("XLM");
    expect(parseRuleAsset(" native ")).toBe("XLM");
  });

  it("accepts the synonyms the model tends to emit", () => {
    expect(parseRuleAsset("dollars")).toBe("USDC");
    expect(parseRuleAsset("stablecoin")).toBe("USDC");
    expect(parseRuleAsset("lumens")).toBe("XLM");
  });

  it("returns null for anything unsupported", () => {
    expect(parseRuleAsset("BTC")).toBeNull();
    expect(parseRuleAsset(undefined)).toBeNull();
    expect(parseRuleAsset(42)).toBeNull();
  });
});

describe("normalizeRuleAsset", () => {
  it("keeps a self-consistent USDC rule unchanged", () => {
    const r = normalizeRuleAsset({ asset: "USDC", trigger: "on every USDC payment received" });
    expect(r).toEqual({
      asset: "USDC",
      trigger: "on every USDC payment received",
      corrected: false,
    });
  });

  it("lets the trigger win when the declared asset contradicts it", () => {
    // The matcher reads the trigger at execution time, so a rule triggered by
    // XLM payments must execute in XLM — otherwise it would match an XLM
    // payment and then attempt a USDC transfer.
    const r = normalizeRuleAsset({ asset: "USDC", trigger: "on every XLM payment received" });
    expect(r.asset).toBe("XLM");
    expect(r.corrected).toBe(true);
  });

  it("names USDC in an otherwise asset-agnostic trigger", () => {
    // Without this the trigger would also match XLM payments and send USDC.
    const r = normalizeRuleAsset({ asset: "USDC", trigger: "on every payment received" });
    expect(r.asset).toBe("USDC");
    expect(r.trigger).toBe("on every USDC payment received");
    expect(r.corrected).toBe(true);
  });

  it("annotates a time-based USDC trigger that has no payment noun", () => {
    const r = normalizeRuleAsset({ asset: "USDC", trigger: "monthly" });
    expect(r.asset).toBe("USDC");
    expect(r.trigger).toBe("monthly (USDC)");
  });

  it("leaves an agnostic XLM rule agnostic", () => {
    // Preserves pre-existing behaviour: an unqualified trigger still matches
    // any supported asset, as it did before asset support was added.
    const r = normalizeRuleAsset({ asset: "XLM", trigger: "on every payment received" });
    expect(r).toEqual({
      asset: "XLM",
      trigger: "on every payment received",
      corrected: false,
    });
  });

  it("defaults to XLM when no asset is declared", () => {
    expect(normalizeRuleAsset({ trigger: "on every payment received" }).asset).toBe("XLM");
    expect(normalizeRuleAsset({}).asset).toBe("XLM");
  });

  it("treats a trigger naming both assets as XLM", () => {
    // Ambiguous — XLM is the safer resolution since it needs no trustline.
    const r = normalizeRuleAsset({ asset: "USDC", trigger: "XLM and USDC payments" });
    expect(r.asset).toBe("XLM");
  });

  it("supplies a trigger when one is missing entirely", () => {
    const r = normalizeRuleAsset({ asset: "USDC" });
    expect(r.trigger).toBe("on every USDC payment received");
    expect(r.asset).toBe("USDC");
  });

  it("produces triggers the matcher then routes correctly", () => {
    // End-to-end on the pure logic: normalise, then confirm the resulting
    // trigger fires for its own asset and not the other.
    for (const asset of ["XLM", "USDC"] as const) {
      const { trigger } = normalizeRuleAsset({ asset, trigger: "on every payment received" });
      const payment = asset === "USDC" ? USDC_TESTNET : "XLM";
      const other = asset === "USDC" ? "XLM" : USDC_TESTNET;

      expect(doesPaymentMatchTrigger(trigger, payment)).toBe(true);
      if (asset === "USDC") {
        // The XLM default stays agnostic by design, so only assert exclusion
        // for the USDC case, where the trigger is rewritten.
        expect(doesPaymentMatchTrigger(trigger, other)).toBe(false);
      }
    }
  });
});
