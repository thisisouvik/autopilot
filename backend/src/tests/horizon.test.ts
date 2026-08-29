import { describe, it, expect, vi } from "vitest";
import { withTimeout, HORIZON_REQUEST_TIMEOUT_MS } from "../stellar/horizon";

const never = new Promise<never>(() => {});

describe("Horizon withTimeout helper", () => {
  it("resolves with the inner promise's value when it settles within the timeout", async () => {
    const value = { id: "p1", amount: "10.0000000" };
    const inner = Promise.resolve(value);

    await expect(withTimeout(inner, 100)).resolves.toBe(value);
  });

  it("rejects with a clear timeout error when the inner promise never settles (large/slow dataset)", async () => {
    await expect(withTimeout(never, 10)).rejects.toThrow(
      "Horizon request timed out after 10ms"
    );
  });

  it("still rejects with the inner promise's own error when it fails before the deadline", async () => {
    const inner = Promise.reject(new Error("Horizon down"));

    await expect(withTimeout(inner, 100)).rejects.toThrow("Horizon down");
  });

  it("clears its internal timer once the inner promise settles (no leaked handle)", async () => {
    // spyOn global setTimeout/clearTimeout to confirm cleanup after resolution
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    await withTimeout(Promise.resolve(1), 100);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("exposes a bounded, positive Horizon timeout", () => {
    expect(HORIZON_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HORIZON_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});