const SUPPORTED_ASSETS = new Set(["XLM", "USDC"]);

export function doesPaymentMatchTrigger(trigger: string | null | undefined, asset: string | null | undefined): boolean {
  if (!trigger || !asset) return false;
  const normalizedTrigger = trigger.toLowerCase().trim();
  const assetCode = asset.trim().toUpperCase().split(":", 1)[0];

  if (!SUPPORTED_ASSETS.has(assetCode)) return false;

  const isPaymentTrigger =
    normalizedTrigger.includes("every payment") ||
    normalizedTrigger.includes("payment") ||
    normalizedTrigger.includes("receive") ||
    normalizedTrigger.includes("received") ||
    normalizedTrigger.includes("incoming") ||
    normalizedTrigger.includes("deposit") ||
    normalizedTrigger.includes("deposited") ||
    normalizedTrigger.includes("salary") ||
    normalizedTrigger.includes("paycheck") ||
    normalizedTrigger.includes("payroll") ||
    normalizedTrigger.includes("income") ||
    normalizedTrigger.includes("inflow") ||
    normalizedTrigger.includes("credited") ||
    normalizedTrigger.includes("transfer");

  if (!isPaymentTrigger) return false;

  const requestedAssets = ["xlm", "usdc"].filter((candidate) =>
    normalizedTrigger.includes(candidate)
  );

  return requestedAssets.length === 0 || requestedAssets.includes(assetCode.toLowerCase());
}