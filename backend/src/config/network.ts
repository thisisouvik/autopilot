// @ts-nocheck
/**
 * config/network.ts
 *
 * Single source of truth for every Stellar network-dependent value.
 *
 * Switching between testnet and mainnet is one env var: STELLAR_NETWORK.
 * Everything else — Horizon endpoint, network passphrase, USDC issuer,
 * explorer links, friendbot availability — is derived from it here, so no
 * other file needs to know which network it is running against.
 *
 * Individual values can still be overridden per-deployment (e.g. pointing
 * HORIZON_URL at a private Horizon instance) without touching this logic.
 */

export type StellarNetwork = "testnet" | "mainnet";

/**
 * Network passphrases are defined by the Stellar protocol (SEP-0001) and are
 * inlined rather than imported from the SDK so this module stays dependency
 * free — it is imported by scripts and tests that never touch the SDK.
 * These match Networks.TESTNET / Networks.PUBLIC exactly.
 */
const PASSPHRASE = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;

/**
 * USDC issuers. These are different accounts on each network — sending to the
 * wrong one is an irrecoverable loss of funds, which is why they live here
 * rather than being duplicated per call site.
 *
 * testnet: Stellar SDF test issuer, paired with testanchor.stellar.org
 * mainnet: Circle's official USDC issuer — https://www.circle.com/en/usdc-multichain/stellar
 */
const USDC_ISSUERS = {
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
} as const;

const HORIZON_URLS = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
} as const;

/**
 * stellar.expert path segment for each network. Note the asymmetry: the
 * explorer calls mainnet "public", not "mainnet" — a routine source of broken
 * links when these URLs are built ad hoc.
 */
const EXPLORER_SEGMENTS = {
  testnet: "testnet",
  mainnet: "public",
} as const;

/**
 * SEP-24 anchor used to obtain test USDC. Testnet only — there is no
 * equivalent faucet on mainnet, where USDC is acquired through Circle or an
 * exchange.
 */
const ANCHOR_URLS = {
  testnet: "https://testanchor.stellar.org/sep24/info",
  mainnet: null,
} as const;

/**
 * Parse STELLAR_NETWORK, defaulting to testnet.
 *
 * Only the exact string "mainnet" selects mainnet. An unrecognised value falls
 * back to testnet with a warning rather than throwing: a typo like
 * STELLAR_NETWORK=main must never silently resolve to mainnet, and failing
 * closed onto testnet is the safe direction.
 */
export function resolveNetwork(raw: string | undefined): StellarNetwork {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "mainnet") return "mainnet";
  if (value === "" || value === "testnet") return "testnet";

  console.warn(
    `[network] Unrecognised STELLAR_NETWORK="${raw}" — falling back to testnet. ` +
      `Set STELLAR_NETWORK="mainnet" exactly to target mainnet.`,
  );
  return "testnet";
}

export const STELLAR_NETWORK: StellarNetwork = resolveNetwork(process.env.STELLAR_NETWORK);

export const IS_MAINNET = STELLAR_NETWORK === "mainnet";
export const IS_TESTNET = !IS_MAINNET;

/** Horizon endpoint. Override with HORIZON_URL to use a private instance. */
export const HORIZON_URL: string = process.env.HORIZON_URL ?? HORIZON_URLS[STELLAR_NETWORK];

export const NETWORK_PASSPHRASE: string = PASSPHRASE[STELLAR_NETWORK];

/** USDC issuer account for the active network. */
export const USDC_ISSUER: string = USDC_ISSUERS[STELLAR_NETWORK];

export const USDC_CODE = "USDC";

/** Base explorer URL, e.g. https://stellar.expert/explorer/testnet */
export const EXPLORER_BASE_URL = `https://stellar.expert/explorer/${EXPLORER_SEGMENTS[STELLAR_NETWORK]}`;

/** Friendbot faucet — testnet only; null on mainnet, where free funding does not exist. */
export const FRIENDBOT_URL: string | null = IS_TESTNET ? "https://friendbot.stellar.org" : null;

/** SEP-24 anchor for acquiring test USDC — null on mainnet. */
export const ANCHOR_URL: string | null = ANCHOR_URLS[STELLAR_NETWORK];

/** Human-readable network name for user-facing copy ("testnet" / "mainnet"). */
export const NETWORK_LABEL: string = STELLAR_NETWORK;

/**
 * Build an explorer URL for a transaction, account, or ledger.
 *
 * Preferred over interpolating EXPLORER_BASE_URL by hand so the network
 * segment is never wrong.
 */
export function explorerUrl(type: "tx" | "account" | "ledger", id: string): string {
  return `${EXPLORER_BASE_URL}/${type}/${id}`;
}

/**
 * Everything above as one object, for logging config at startup or passing the
 * resolved network to the frontend.
 */
export function networkConfig() {
  return {
    network: STELLAR_NETWORK,
    horizonUrl: HORIZON_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    usdcIssuer: USDC_ISSUER,
    explorerBaseUrl: EXPLORER_BASE_URL,
    friendbotUrl: FRIENDBOT_URL,
    anchorUrl: ANCHOR_URL,
    isTestnet: IS_TESTNET,
  };
}
