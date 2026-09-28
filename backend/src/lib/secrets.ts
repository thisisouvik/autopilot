// @ts-nocheck
/**
 * Resolves the engine hot-wallet secret key securely.
 * Supports HashiCorp Vault, AWS Secrets Manager (via Lambda extension), or falls back to ENV.
 */
export async function getEngineSecret(): Promise<string> {
  // 1. AWS Secrets Manager (via Lambda Extension)
  if (process.env.AWS_SECRETS_EXTENSION_HTTP_PORT && process.env.AUTOPILOT_SECRET_ID) {
    try {
      const port = process.env.AWS_SECRETS_EXTENSION_HTTP_PORT;
      const res = await fetch(`http://localhost:${port}/secretsmanager/get?secretId=${process.env.AUTOPILOT_SECRET_ID}`, {
        headers: { "X-Aws-Parameters-Secrets-Token": process.env.AWS_SESSION_TOKEN || "" }
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data.SecretString) return data.SecretString;
      }
    } catch (err) {
      console.error("[Secrets] Failed to fetch from AWS Secrets Manager:", err);
    }
  }

  // 2. HashiCorp Vault
  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN && process.env.VAULT_SECRET_PATH) {
    try {
      const res = await fetch(`${process.env.VAULT_ADDR}/v1/${process.env.VAULT_SECRET_PATH}`, {
        headers: { "X-Vault-Token": process.env.VAULT_TOKEN }
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data.data?.data?.AUTOPILOT_SECRET_KEY) {
          return data.data.data.AUTOPILOT_SECRET_KEY;
        }
      }
    } catch (err) {
      console.error("[Secrets] Failed to fetch from HashiCorp Vault:", err);
    }
  }

  // 3. Fallback to Environment Variable
  const secret = process.env.AUTOPILOT_SECRET_KEY;
  if (!secret) {
    throw new Error("AUTOPILOT_SECRET_KEY not found in env and no secrets manager configured.");
  }
  return secret;
}
