/**
 * lib/network.ts
 *
 * Frontend mirror of backend/src/config/network.ts — the single source of truth
 * for every Stellar network-dependent value used in the UI.
 *
 * Why a separate file: the frontend and backend deploy independently (Vercel /
 * Render) with no shared workspace, and values referenced in client components
 * must be inlined at build time from a NEXT_PUBLIC_* variable. Importing across
 * the package boundary would not survive the bundler.
 *
 * Switching networks is one env var: NEXT_PUBLIC_STELLAR_NETWORK, set to match
 * the backend's STELLAR_NETWORK. Keep the values here in sync with the backend
 * config.
 */

export type StellarNetwork = "testnet" | "mainnet";

const HORIZON_URLS = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
} as const;

/** stellar.expert calls mainnet "public", not "mainnet". */
const EXPLORER_SEGMENTS = {
  testnet: "testnet",
  mainnet: "public",
} as const;

/** SEP-24 test USDC anchor. Testnet only — no mainnet equivalent. */
const ANCHOR_URLS = {
  testnet: "https://testanchor.stellar.org/sep24/info",
  mainnet: null,
} as const;

/**
 * Only the exact string "mainnet" selects mainnet, so a typo can never
 * silently point the UI at real funds.
 *
 * Note: this is read at module scope so Next.js inlines it at build time.
 * Changing the variable requires a rebuild, not just a restart.
 */
function resolveNetwork(raw: string | undefined): StellarNetwork {
  return (raw ?? "").trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

export const STELLAR_NETWORK: StellarNetwork = resolveNetwork(
  process.env.NEXT_PUBLIC_STELLAR_NETWORK,
);

export const IS_MAINNET = STELLAR_NETWORK === "mainnet";
export const IS_TESTNET = !IS_MAINNET;

/** Horizon endpoint. Override with NEXT_PUBLIC_HORIZON_URL for a private instance. */
export const HORIZON_URL: string =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? HORIZON_URLS[STELLAR_NETWORK];

export const EXPLORER_BASE_URL = `https://stellar.expert/explorer/${EXPLORER_SEGMENTS[STELLAR_NETWORK]}`;

/** Test USDC faucet — null on mainnet, so callers can hide the affordance. */
export const ANCHOR_URL: string | null = ANCHOR_URLS[STELLAR_NETWORK];

/** Network name for user-facing copy. */
export const NETWORK_LABEL: string = STELLAR_NETWORK;

/** Default deployed VaultFactory smart contract ID on testnet. */
const DEFAULT_FACTORY_CONTRACT_IDS = {
  testnet: "CDDS2SVBJQY3XBGSXVMEOJGXVGNNJ3STBSAK34QFLEVXM4MQ2QVLF6N3",
  mainnet: "",
} as const;

export const FACTORY_CONTRACT_ID: string =
  process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID ?? DEFAULT_FACTORY_CONTRACT_IDS[STELLAR_NETWORK];

/** Build an explorer URL so the network segment is never wrong. */
export function explorerUrl(type: "tx" | "account" | "ledger" | "contract", id: string): string {
  return `${EXPLORER_BASE_URL}/${type}/${id}`;
}

/** Horizon account endpoint for a public key. */
export function horizonAccountUrl(publicKey: string): string {
  return `${HORIZON_URL}/accounts/${publicKey}`;
}
