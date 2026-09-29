// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import authRoutes, {
  AUTH_CHALLENGE_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  hashStellarSignedMessage,
} from "../routes/auth";
import { verifyAuth } from "../middleware/auth";

const { mockSql, mockCheckRateLimit } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => mockSql,
}));

vi.mock("../lib/redis", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

const TEST_KEYPAIR = Keypair.fromSecret(
  "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW",
);
const PUBLIC_KEY = TEST_KEYPAIR.publicKey();
const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  publicKey: PUBLIC_KEY,
};
const CHALLENGE_ID = "22222222-2222-4222-8222-222222222222";

function decodePayload(token: string): { iat: number; exp: number; id: string; publicKey: string } {
  const [, body] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString());
}

function signChallenge(message: string, keypair = TEST_KEYPAIR): string {
  return keypair.sign(hashStellarSignedMessage(message)).toString("base64");
}

describe("AutoPilot signed wallet authentication", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();

    await server.register(import("@fastify/jwt"), {
      secret: "test-secret",
      cookie: {
        cookieName: "session",
        signed: false,
      },
    });
    await server.register(import("@fastify/cookie"));

    server.register(authRoutes, { prefix: "/api/auth" });
    server.get("/protected", { preHandler: [verifyAuth] }, async (request) => ({
      user: request.user,
    }));

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockSql.mockReset();
    mockCheckRateLimit.mockReset();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
  });

  it("matches the official SEP-53 message-signing test vector", () => {
    const signature = Buffer.from(
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
      "base64",
    );

    expect(PUBLIC_KEY).toBe("GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L");
    expect(TEST_KEYPAIR.verify(hashStellarSignedMessage("Hello, World!"), signature)).toBe(true);
  });

  it("creates a short-lived challenge bound to the requested public key", async () => {
    mockSql.mockResolvedValueOnce([]);

    const before = Date.now();
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/challenge",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.message).toContain(`Public key: ${PUBLIC_KEY}`);
    expect(body.message).toContain("Sign in to AutoPilot");
    expect(new Date(body.expiresAt).getTime() - before).toBeGreaterThan(
      (AUTH_CHALLENGE_TTL_SECONDS - 2) * 1000,
    );
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("rejects a public-key-only login without querying the database", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toMatch(/challengeId and signature are required/i);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("issues a session only after a valid SEP-53 challenge signature", async () => {
    const message = `Sign in to AutoPilot\nPublic key: ${PUBLIC_KEY}\nNonce: valid`;
    mockSql
      .mockResolvedValueOnce([{ message }])
      .mockResolvedValueOnce([USER]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        publicKey: PUBLIC_KEY,
        challengeId: CHALLENGE_ID,
        signature: signChallenge(message),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ success: true, user: USER });

    const setCookie = response.headers["set-cookie"] as string;
    expect(setCookie).toContain("session=");
    expect(setCookie).toMatch(/Max-Age=604800/);
    expect(setCookie).toMatch(/HttpOnly/);

    const token = setCookie.split(";")[0].split("=")[1];
    const payload = decodePayload(token);
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("rejects a signature made by a different Stellar key", async () => {
    const message = `Sign in to AutoPilot\nPublic key: ${PUBLIC_KEY}\nNonce: wrong-signer`;
    mockSql.mockResolvedValueOnce([{ message }]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        publicKey: PUBLIC_KEY,
        challengeId: CHALLENGE_ID,
        signature: signChallenge(message, Keypair.random()),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toBe("Invalid wallet signature");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired, mismatched, or already-consumed challenge", async () => {
    mockSql.mockResolvedValueOnce([]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        publicKey: PUBLIC_KEY,
        challengeId: CHALLENGE_ID,
        signature: Buffer.alloc(64).toString("base64"),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toMatch(/expired|already used/i);
  });

  it("prevents replay by accepting the same challenge only once", async () => {
    const message = `Sign in to AutoPilot\nPublic key: ${PUBLIC_KEY}\nNonce: one-time`;
    const payload = {
      publicKey: PUBLIC_KEY,
      challengeId: CHALLENGE_ID,
      signature: signChallenge(message),
    };
    mockSql
      .mockResolvedValueOnce([{ message }])
      .mockResolvedValueOnce([USER])
      .mockResolvedValueOnce([]);

    const first = await server.inject({ method: "POST", url: "/api/auth/login", payload });
    const replay = await server.inject({ method: "POST", url: "/api/auth/login", payload });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(401);
  });

  it("fails closed with 503 when challenge persistence is unavailable", async () => {
    mockSql.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/challenge",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).error).toMatch(/temporarily unavailable/i);
  });

  it("fails closed with 503 when the one-time challenge cannot be consumed", async () => {
    mockSql.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        publicKey: PUBLIC_KEY,
        challengeId: CHALLENGE_ID,
        signature: Buffer.alloc(64).toString("base64"),
      },
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).error).toMatch(/temporarily unavailable/i);
  });

  it("validates challenge and login request fields", async () => {
    const missingKey = await server.inject({
      method: "POST",
      url: "/api/auth/challenge",
      payload: {},
    });
    const malformedKey = await server.inject({
      method: "POST",
      url: "/api/auth/challenge",
      payload: { publicKey: "NOT-A-STELLAR-KEY" },
    });
    const malformedChallengeId = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY, challengeId: "not-a-uuid", signature: "invalid" },
    });

    expect(missingKey.statusCode).toBe(400);
    expect(malformedKey.statusCode).toBe(400);
    expect(malformedChallengeId.statusCode).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rate limits login attempts before consuming a challenge", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        publicKey: PUBLIC_KEY,
        challengeId: CHALLENGE_ID,
        signature: Buffer.alloc(64).toString("base64"),
      },
    });

    expect(response.statusCode).toBe(429);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("GET /me returns 401 without a session and returns the JWT user with one", async () => {
    const unauthenticated = await server.inject({ method: "GET", url: "/api/auth/me" });
    expect(unauthenticated.statusCode).toBe(401);

    const token = server.jwt.sign({ id: USER.id, publicKey: PUBLIC_KEY }, { expiresIn: "1h" });
    const authenticated = await server.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { session: token },
    });

    expect(authenticated.statusCode).toBe(200);
    expect(JSON.parse(authenticated.payload).user.publicKey).toBe(PUBLIC_KEY);
  });

  it("logout clears the session cookie", async () => {
    const response = await server.inject({ method: "POST", url: "/api/auth/logout" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toMatch(/Max-Age=0/);
  });

  it("verifyAuth rejects an expired token", async () => {
    const expiredToken = server.jwt.sign(
      { id: USER.id, publicKey: PUBLIC_KEY },
      { expiresIn: -10 },
    );
    const response = await server.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: expiredToken },
    });

    expect(response.statusCode).toBe(401);
  });
});
