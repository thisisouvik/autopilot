import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import authRoutes, { SESSION_TTL_SECONDS } from "../routes/auth";
import { verifyAuth } from "../middleware/auth";

// ── DB mock ──────────────────────────────────────────────────────────────────
// The login route upserts the user through getDb() (neon). Stubbing the module
// lets each test script exactly which row the route "sees" so we can exercise
// the login success path deterministically without a database.
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

const PUBLIC_KEY = "GCWVJI2QBJQXNJIOU5PAZEAHQFNZGZMQFAF36C2YSF4X4YLQTISN3BQR";

// Helper: decode the JWT payload (base64url) without extra dependencies.
function decodePayload(token: string): { iat: number; exp: number; id: string; publicKey: string } {
  const [, body] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString());
}

describe("AutoPilot Auth Token Expiry Tests", () => {
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

    // A minimal protected route that exercises the real verifyAuth middleware,
    // so we can probe token acceptance/rejection (expiry + clock tolerance)
    // without touching the database.
    server.get("/protected", { preHandler: [verifyAuth] }, async (request) => {
      return { user: request.user };
    });

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockSql.mockReset();
    mockCheckRateLimit.mockReset();
    // Default: rate limit allows the request (mirrors no-Redis fallback).
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
  });

  // ── Success path ──────────────────────────────────────────────────────────
  it("login issues a session cookie whose JWT lifetime and Max-Age both equal SESSION_TTL_SECONDS", async () => {
    mockSql.mockResolvedValueOnce([
      { id: "11111111-1111-4111-8111-111111111111", publicKey: PUBLIC_KEY },
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);

    const setCookie = response.headers["set-cookie"] as string;
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("session=");
    expect(setCookie).toMatch(/Max-Age=604800/);
    expect(setCookie).toMatch(/HttpOnly/);

    // The JWT lifespan must be exactly the shared session TTL — no more, no less.
    const token = setCookie.split(";")[0].split("=")[1];
    const payload = decodePayload(token);
    expect(typeof payload.iat).toBe("number");
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("login succeeds with a freshly upserted user (id + publicKey returned)", async () => {
    mockSql.mockResolvedValueOnce([
      { id: "11111111-1111-4111-8111-111111111111", publicKey: PUBLIC_KEY },
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.user.publicKey).toBe(PUBLIC_KEY);
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  // ── Failure paths ─────────────────────────────────────────────────────────
  it("returns 400 when publicKey is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe("publicKey is required");
  });

  it("returns 400 for a malformed Stellar public key", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: "NOT-A-STELLAR-KEY" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toMatch(/Invalid Stellar public key/);
  });

  it("returns 401 on /me when no session cookie is present", async () => {
    const response = await server.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toBe("Not authenticated");
  });

  it("a signature supplied without a message (or vice-versa) skips verification and still logs in", async () => {
    mockSql.mockResolvedValueOnce([
      { id: "11111111-1111-4111-8111-111111111111", publicKey: PUBLIC_KEY },
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY, signature: "only-a-signature" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("an invalid wallet signature (both signature + message present) is rejected with 401", async () => {
    // A 64-byte garbage signature (correct length for ed25519) that will never verify.
    const garbageSig = Buffer.alloc(64, 0xab).toString("base64");
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY, signature: garbageSig, message: "hello" },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toMatch(/Invalid wallet signature|Signature verification failed/i);
  });

  it("returns 429 when the login rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { publicKey: PUBLIC_KEY },
    });

    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.payload).error).toMatch(/Too many login attempts/i);
  });

  it("GET /me returns the JWT user when authenticated", async () => {
    const token = server.jwt.sign({ id: "1", publicKey: PUBLIC_KEY }, { expiresIn: "1h" });

    const response = await server.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).user.publicKey).toBe(PUBLIC_KEY);
  });

  it("logout clears the session cookie (Max-Age=0)", async () => {
    const response = await server.inject({ method: "POST", url: "/api/auth/logout" });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"] as string;
    expect(setCookie).toContain("session=");
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  it("verifyAuth accepts a token that is still within its lifetime (no premature logout)", async () => {
    const token = server.jwt.sign({ id: "1", publicKey: PUBLIC_KEY }, { expiresIn: "1h" });

    const response = await server.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).user.publicKey).toBe(PUBLIC_KEY);
  });

  it("verifyAuth returns 401 once the token is genuinely expired (exp passed)", async () => {
    // Sign a token that expires in the past — this is the ONE case that SHOULD
    // log the user out. Anything earlier than this is a premature logout.
    const expiredToken = server.jwt.sign(
      { id: "1", publicKey: PUBLIC_KEY },
      { expiresIn: -10 } // negative => already expired
    );

    const response = await server.inject({
      method: "GET",
      url: "/protected",
      cookies: { session: expiredToken },
    });

    expect(response.statusCode).toBe(401);
  });
});