// @ts-nocheck
const REQUIRED_ENV_VARS = [
  "JWT_SECRET",
  "DATABASE_URL",
  "AUTOPILOT_SECRET_KEY",
  "AUTOPILOT_PUBLIC_KEY",
  "VAULT_ENCRYPTION_KEY",
] as const;

const PLACEHOLDER_VALUES = new Set([
  "super-secret-key-for-dev",
  "your-super-secret-jwt-key-replace-me-in-production",
  "S...your_stellar_secret_key...",
  "G...your_stellar_public_key...",
  "your_64_char_hex_key_here",
]);

function requireValidUrl(name: string, value: string, protocols: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of these protocols: ${protocols.join(", ")}`);
  }
}

function validatePositiveInteger(name: string) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const jwtSecret = process.env.JWT_SECRET!;
  const databaseUrl = process.env.DATABASE_URL!;
  const secretKey = process.env.AUTOPILOT_SECRET_KEY!;
  const publicKey = process.env.AUTOPILOT_PUBLIC_KEY!;
  const encryptionKey = process.env.VAULT_ENCRYPTION_KEY!;
  const isProduction = process.env.NODE_ENV === "production";

  requireValidUrl("DATABASE_URL", databaseUrl, ["postgres:", "postgresql:"]);

  if (!/^S[A-Z2-7]{55}$/.test(secretKey)) {
    throw new Error("AUTOPILOT_SECRET_KEY must be a valid Stellar secret key");
  }
  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
    throw new Error("AUTOPILOT_PUBLIC_KEY must be a valid Stellar public key");
  }
  if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error("VAULT_ENCRYPTION_KEY must be a 64-character hexadecimal key");
  }

  const network = process.env.STELLAR_NETWORK?.trim().toLowerCase();
  if (network && network !== "testnet" && network !== "mainnet") {
    throw new Error('STELLAR_NETWORK must be either "testnet" or "mainnet"');
  }

  if (process.env.HORIZON_URL) {
    requireValidUrl("HORIZON_URL", process.env.HORIZON_URL, ["http:", "https:"]);
  }

  if (isProduction) {
    if (!network) {
      throw new Error(
        'STELLAR_NETWORK must be explicitly set to "testnet" or "mainnet" in production',
      );
    }
    if (jwtSecret.length < 32 || PLACEHOLDER_VALUES.has(jwtSecret)) {
      throw new Error("JWT_SECRET must be a non-placeholder value of at least 32 characters in production");
    }
    for (const name of REQUIRED_ENV_VARS) {
      if (PLACEHOLDER_VALUES.has(process.env[name]!)) {
        throw new Error(`${name} must not use the example placeholder in production`);
      }
    }
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (Boolean(redisUrl) !== Boolean(redisToken)) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together",
    );
  }
  if (redisUrl) requireValidUrl("UPSTASH_REDIS_REST_URL", redisUrl, ["http:", "https:"]);
  if (process.env.REDIS_URL) {
    requireValidUrl("REDIS_URL", process.env.REDIS_URL, ["redis:", "rediss:"]);
  }

  validatePositiveInteger("PORT");
  validatePositiveInteger("MAX_RULES_PER_USER");
  validatePositiveInteger("MAX_GOALS_PER_USER");
}
