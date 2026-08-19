# Security Policy

## Supported Versions

We actively maintain and patch the following versions of AutoPilot:

| Version | Supported |
|---------|-----------|
| `main` branch | ✅ Yes |
| Older branches | ❌ No |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub Issues.**

AutoPilot handles real user funds and Stellar keypairs. Security vulnerabilities — especially those affecting vault key management, the rule engine, or the Soroban smart contract — must be reported responsibly.

### How to Report

1. **Open a private GitHub Security Advisory** by going to:
   `https://github.com/thisisouvik/autopilot/security/advisories/new`

2. **Include the following in your report:**
   - A clear description of the vulnerability
   - The component affected (frontend, backend, Soroban contract, Stellar integration)
   - Steps to reproduce the issue
   - The potential impact (e.g., fund loss, key exposure, unauthorized transactions)
   - Any suggested mitigations or fixes

3. **We will respond within 48 hours** to acknowledge your report.

4. We will work with you to understand and validate the issue, then **coordinate a fix and responsible disclosure timeline**.

### Scope

Security issues we prioritize:

- 🔴 **Critical:** Private key / secret exposure (`AUTOPILOT_SECRET_KEY`, `VAULT_ENCRYPTION_KEY`)
- 🔴 **Critical:** Smart contract vulnerabilities enabling unauthorized fund withdrawal
- 🔴 **Critical:** Race conditions enabling double-spend of user funds
- 🟠 **High:** Authentication/authorization bypass in the backend API
- 🟠 **High:** Vault key decryption vulnerabilities
- 🟡 **Medium:** Rule engine manipulation or injection
- 🟡 **Medium:** Denial of service against the Horizon stream or BullMQ queue

### Out of Scope

- Testnet-only issues with no mainnet impact
- UI/UX bugs without security implications
- Issues in third-party dependencies (please report those upstream)

## Security Best Practices for Self-Hosters

If you are running your own instance of AutoPilot:

1. **Never commit `.env` files** — they contain secret keys.
2. **Generate a strong `VAULT_ENCRYPTION_KEY`:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. **Rotate your `AUTOPILOT_SECRET_KEY` regularly** and keep XLM balance minimal.
4. **Use a secrets manager** (AWS Secrets Manager, Doppler, etc.) instead of plain `.env` in production.
5. **Keep dependencies up to date** with `npm audit` and `cargo audit`.

## Hall of Fame

We appreciate responsible disclosure. Verified reporters of valid security issues will be acknowledged here (with their permission).

| Researcher | Issue | Date |
|-----------|-------|------|
| — | — | — |
