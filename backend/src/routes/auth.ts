// @ts-nocheck
import { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { getDb } from "../lib/db";
import { checkRateLimit } from "../lib/redis";

// Single source of truth for the session lifetime (7 days). It must be identical
// for the JWT `expiresIn` and the HttpOnly cookie `maxAge`, otherwise the browser
// drops the cookie before the token is actually expired (or vice-versa), logging
// the user out prematurely.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;
const STELLAR_SIGNED_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export function hashStellarSignedMessage(message: string): Buffer {
  return createHash("sha256")
    .update(STELLAR_SIGNED_MESSAGE_PREFIX, "utf8")
    .update(message, "utf8")
    .digest();
}

function decodeSignature(signature: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return null;

  const decoded = Buffer.from(signature, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== signature) return null;
  return decoded;
}

function buildChallengeMessage(publicKey: string, nonce: string, issuedAt: Date, expiresAt: Date) {
  const origin = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return [
    "Sign in to AutoPilot",
    `Origin: ${origin}`,
    `Public key: ${publicKey}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt.toISOString()}`,
    `Expires at: ${expiresAt.toISOString()}`,
    "This request will not submit a transaction or cost XLM.",
  ].join("\n");
}

export default async function authRoutes(server: FastifyInstance) {

  /**
   * POST /api/auth/challenge
   * Creates a short-lived, one-time message bound to a Stellar public key.
   */
  server.post("/challenge", async (request: any, reply: any) => {
    const { publicKey } = (request.body ?? {}) as { publicKey?: string };

    if (!publicKey) {
      return reply.status(400).send({ error: "publicKey is required" });
    }
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      return reply.status(400).send({ error: "Invalid Stellar public key format" });
    }

    const ip = request.ip ?? "unknown";
    const { allowed } = await checkRateLimit(`auth-challenge:${ip}`, 10, 60);
    if (!allowed) {
      return reply.status(429).send({ error: "Too many authentication attempts. Please wait a minute." });
    }

    const id = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + AUTH_CHALLENGE_TTL_SECONDS * 1000);
    const message = buildChallengeMessage(
      publicKey,
      randomBytes(32).toString("base64url"),
      issuedAt,
      expiresAt,
    );

    try {
      const sql = getDb();
      await sql`
        WITH expired_challenges AS (
          DELETE FROM "AuthChallenge" WHERE "expiresAt" <= NOW()
        )
        INSERT INTO "AuthChallenge" (id, "publicKey", message, "expiresAt", "createdAt")
        VALUES (${id}::uuid, ${publicKey}, ${message}, ${expiresAt}, NOW())
      `;
    } catch (error) {
      request.log.error({ err: error }, "Failed to persist authentication challenge");
      return reply.status(503).send({ error: "Authentication is temporarily unavailable" });
    }

    return reply.send({ challengeId: id, message, expiresAt: expiresAt.toISOString() });
  });

  /**
   * POST /api/auth/login
   * Consumes a one-time challenge and verifies its SEP-53 signature before
   * issuing a JWT stored in an HttpOnly cookie.
   */
  server.post("/login", async (request: any, reply: any) => {
    const { publicKey, challengeId, signature } = (request.body ?? {}) as {
      publicKey?: string;
      challengeId?: string;
      signature?: string;
    };

    if (!publicKey) {
      return reply.status(400).send({ error: "publicKey is required" });
    }

    // Validate it's a real Stellar public key (G...)
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      return reply.status(400).send({ error: "Invalid Stellar public key format" });
    }
    if (!challengeId || !signature) {
      return reply.status(400).send({ error: "challengeId and signature are required" });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
      return reply.status(400).send({ error: "Invalid challengeId format" });
    }

    // Rate limit: max 10 login attempts per IP per minute
    const ip = request.ip ?? "unknown";
    const { allowed } = await checkRateLimit(`login:${ip}`, 10, 60);
    if (!allowed) {
      return reply.status(429).send({ error: "Too many login attempts. Please wait a minute." });
    }

    let sql: ReturnType<typeof getDb>;
    let challenge: { message: string } | undefined;
    try {
      sql = getDb();
      const challenges = await sql`
        DELETE FROM "AuthChallenge"
        WHERE id = ${challengeId}::uuid
          AND "publicKey" = ${publicKey}
          AND "expiresAt" > NOW()
        RETURNING message
      `;
      challenge = challenges[0] as { message: string } | undefined;
    } catch (error) {
      request.log.error({ err: error }, "Failed to consume authentication challenge");
      return reply.status(503).send({ error: "Authentication is temporarily unavailable" });
    }

    if (!challenge) {
      return reply.status(401).send({ error: "Invalid, expired, or already used authentication challenge" });
    }

    const signatureBytes = decodeSignature(signature);
    if (!signatureBytes) {
      return reply.status(401).send({ error: "Invalid wallet signature" });
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    if (!keypair.verify(hashStellarSignedMessage(challenge.message), signatureBytes)) {
      return reply.status(401).send({ error: "Invalid wallet signature" });
    }

    // Upsert user — create if new, return existing if not
    const users = await sql`
      INSERT INTO "User" (id, "publicKey", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${publicKey}, NOW(), NOW())
      ON CONFLICT ("publicKey") DO UPDATE
        SET "updatedAt" = NOW()
      RETURNING id, "publicKey"
    `;

    const user = users[0];

    // Issue JWT + cookie using ONE shared TTL so the token and the cookie always
    // stay in sync (this is what prevents users being logged out before exp).
    const token = server.jwt.sign(
      { id: user.id, publicKey: user.publicKey },
      { expiresIn: SESSION_TTL_SECONDS }
    );

    const isProd = process.env.NODE_ENV === "production";
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      // cross-domain (Vercel frontend ↔ Render backend) requires sameSite "none" + secure
      sameSite: isProd ? "none" : "strict",
      maxAge: SESSION_TTL_SECONDS,
    });

    return reply.send({ success: true, user: { id: user.id, publicKey: user.publicKey } });
  });

  /**
   * POST /api/auth/logout
   * Clears the session cookie.
   */
  server.post("/logout", async (request: any, reply: any) => {
    const isProd = process.env.NODE_ENV === "production";
    reply.setCookie("session", "", {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "strict",
      maxAge: 0,
    });
    return reply.send({ success: true });
  });

  /**
   * GET /api/auth/me
   * Returns the currently logged-in user from the JWT cookie.
   */
  server.get("/me", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      return reply.send({ user: request.user });
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
  });
}
