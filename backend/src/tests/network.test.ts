// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * config/network.ts resolves everything at module scope from process.env, so
 * each case sets the env and re-imports with a reset module registry.
 */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("../config/network");
}

const TESTNET_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MAINNET_USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("network config", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.HORIZON_URL;
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("defaults to testnet when STELLAR_NETWORK is unset", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: undefined });
    expect(cfg.STELLAR_NETWORK).toBe("testnet");
    expect(cfg.IS_TESTNET).toBe(true);
    expect(cfg.IS_MAINNET).toBe(false);
  });

  it("resolves the full testnet profile", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: "testnet" });
    expect(cfg.HORIZON_URL).toBe("https://horizon-testnet.stellar.org");
    expect(cfg.NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
    expect(cfg.USDC_ISSUER).toBe(TESTNET_USDC);
    expect(cfg.EXPLORER_BASE_URL).toBe("https://stellar.expert/explorer/testnet");
    expect(cfg.FRIENDBOT_URL).toBe("https://friendbot.stellar.org");
    expect(cfg.ANCHOR_URL).toBe("https://testanchor.stellar.org/sep24/info");
  });

  it("resolves the full mainnet profile", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: "mainnet" });
    expect(cfg.HORIZON_URL).toBe("https://horizon.stellar.org");
    expect(cfg.NETWORK_PASSPHRASE).toBe("Public Global Stellar Network ; September 2015");
    expect(cfg.USDC_ISSUER).toBe(MAINNET_USDC);
    // stellar.expert names mainnet "public", not "mainnet".
    expect(cfg.EXPLORER_BASE_URL).toBe("https://stellar.expert/explorer/public");
    // Neither free funding nor a test anchor exists on mainnet.
    expect(cfg.FRIENDBOT_URL).toBeNull();
    expect(cfg.ANCHOR_URL).toBeNull();
  });

  it("uses a different USDC issuer per network", async () => {
    // Paying the wrong issuer is an irrecoverable loss, so assert they differ.
    const testnet = await loadConfig({ STELLAR_NETWORK: "testnet" });
    const mainnet = await loadConfig({ STELLAR_NETWORK: "mainnet" });
    expect(testnet.USDC_ISSUER === mainnet.USDC_ISSUER).toBe(false);
  });

  it("falls back to testnet on an unrecognised value rather than mainnet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A typo must never resolve to mainnet — failing closed onto testnet is safe.
    const cfg = await loadConfig({ STELLAR_NETWORK: "main" });
    expect(cfg.STELLAR_NETWORK).toBe("testnet");
    expect(warn).toHaveBeenCalled();
  });

  it("accepts case and whitespace variations of mainnet", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: "  MainNet " });
    expect(cfg.STELLAR_NETWORK).toBe("mainnet");
  });

  it("lets HORIZON_URL override the network default", async () => {
    const cfg = await loadConfig({
      STELLAR_NETWORK: "mainnet",
      HORIZON_URL: "https://my-private-horizon.example.com",
    });
    expect(cfg.HORIZON_URL).toBe("https://my-private-horizon.example.com");
    // Overriding the endpoint must not change the network identity.
    expect(cfg.NETWORK_PASSPHRASE).toBe("Public Global Stellar Network ; September 2015");
    expect(cfg.USDC_ISSUER).toBe(MAINNET_USDC);
  });

  it("builds explorer URLs for each resource type", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: "testnet" });
    expect(cfg.explorerUrl("tx", "abc123")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
    expect(cfg.explorerUrl("account", "GTEST")).toBe(
      "https://stellar.expert/explorer/testnet/account/GTEST",
    );
  });

  it("switches explorer URLs with the network", async () => {
    const mainnet = await loadConfig({ STELLAR_NETWORK: "mainnet" });
    expect(mainnet.explorerUrl("tx", "abc123")).toBe(
      "https://stellar.expert/explorer/public/tx/abc123",
    );
  });

  it("exposes the resolved config as one object", async () => {
    const cfg = await loadConfig({ STELLAR_NETWORK: "mainnet" });
    expect(cfg.networkConfig()).toMatchObject({
      network: "mainnet",
      usdcIssuer: MAINNET_USDC,
      isTestnet: false,
      friendbotUrl: null,
    });
  });

  it("matches the passphrases the Stellar SDK defines", async () => {
    // These are protocol constants inlined to keep the config dependency free;
    // drifting from the SDK would silently invalidate every signature. Skipped
    // rather than failed when dependencies are not installed, so the rest of
    // the suite still runs in a bare checkout.
    let Networks: { TESTNET: string; PUBLIC: string };
    try {
      ({ Networks } = await import("@stellar/stellar-sdk"));
    } catch {
      console.warn("[network.test] @stellar/stellar-sdk not installed — skipping drift check");
      return;
    }

    const testnet = await loadConfig({ STELLAR_NETWORK: "testnet" });
    const mainnet = await loadConfig({ STELLAR_NETWORK: "mainnet" });
    expect(testnet.NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(mainnet.NETWORK_PASSPHRASE).toBe(Networks.PUBLIC);
  });

  describe("resolveNetwork", () => {
    it("maps values to a network without reading the environment", async () => {
      const { resolveNetwork } = await loadConfig({});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveNetwork("mainnet")).toBe("mainnet");
      expect(resolveNetwork("testnet")).toBe("testnet");
      expect(resolveNetwork(undefined)).toBe("testnet");
      expect(resolveNetwork("")).toBe("testnet");
      expect(resolveNetwork("public")).toBe("testnet");
      warn.mockRestore();
    });
  });
});
