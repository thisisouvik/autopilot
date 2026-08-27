import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import accountRoutes from "../routes/account";

// ── DB mock ──────────────────────────────────────────────────────────────────
// The account route resolves its queries through getDb() (neon). We stub the
// module so each test can script exactly which rows the route "sees", which is
// what lets us exercise the missing-user path that previously crashed.
const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock("../lib/db", () => ({
  getDb: () => mockSql,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_KEY = "GCWVJI2QBJQXNJIOU5PAZEAHQFNZGZMQFAF36C2YSF4X4YLQTISN3BQR";

// A freshly-registered user row (no rules, no transactions, no limits).
const newUserRow = {
  id: USER_ID,
  publicKey: PUBLIC_KEY,
  dailyLimit: null,
  weeklyLimit: null,
  plan: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AutoPilot Account Route API Tests", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();

    // Register basic plugins needed by routes (mirrors tests/api.test.ts)
    await server.register(import("@fastify/jwt"), {
      secret: "test-secret",
      cookie: {
        cookieName: "session",
        signed: false,
      },
    });
    await server.register(import("@fastify/cookie"));

    server.register(accountRoutes, { prefix: "/api/account" });

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockSql.mockReset();
  });

  it("returns 401 when unauthenticated (missing session cookie)", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/account",
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload)).toHaveProperty("error");
  });

  it("returns 401 on PATCH when unauthenticated", async () => {
    const response = await server.inject({
      method: "PATCH",
      url: "/api/account",
      payload: { dailyLimit: 50 },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload)).toHaveProperty("error");
  });

  it("returns account details for a newly registered user (empty rules + transactions)", async () => {
    const token = server.jwt.sign({ id: USER_ID, publicKey: PUBLIC_KEY });

    // Script the three parallel queries: user row, active-rule count, transactions
    mockSql
      .mockResolvedValueOnce([newUserRow])
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    const response = await server.inject({
      method: "GET",
      url: "/api/account",
      cookies: { session: token },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.publicKey).toBe(PUBLIC_KEY);
    expect(body.dailyLimit).toBeNull();
    expect(body.weeklyLimit).toBeNull();
    expect(body.plan).toBe("free");
    expect(body.activeRules).toBe(0);
    expect(body.transactions).toEqual([]);
  });

  it("returns 401 instead of crashing when the session user has no DB row (null-pointer regression)", async () => {
    const token = server.jwt.sign({ id: USER_ID, publicKey: PUBLIC_KEY });

    // Simulate a valid JWT whose user no longer exists in the DB — this is the
    // path that used to throw on `userRows[0].publicKey` (500 / app crash).
    mockSql
      .mockResolvedValueOnce([]) // user query → no rows
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    const response = await server.inject({
      method: "GET",
      url: "/api/account",
      cookies: { session: token },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toMatch(/User not found/i);
  });

  it("returns the user's daily limit, plan and active-rule count when populated", async () => {
    const token = server.jwt.sign({ id: USER_ID, publicKey: PUBLIC_KEY });

    mockSql
      .mockResolvedValueOnce([{ ...newUserRow, dailyLimit: "10.5", weeklyLimit: "50", plan: "premium" }])
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        { id: "tx-1", type: "save", amount: 1.25, memo: null, txHash: "abc", createdAt: new Date().toISOString() },
      ]);

    const response = await server.inject({
      method: "GET",
      url: "/api/account",
      cookies: { session: token },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.dailyLimit).toBe("10.5");
    expect(body.weeklyLimit).toBe("50");
    expect(body.plan).toBe("premium");
    expect(body.activeRules).toBe(2);
    expect(body.transactions).toHaveLength(1);
  });

  it("updates user limits via PATCH when authenticated", async () => {
    const token = server.jwt.sign({ id: USER_ID, publicKey: PUBLIC_KEY });

    mockSql.mockResolvedValueOnce([]); // UPDATE ... (single query, result ignored)

    const response = await server.inject({
      method: "PATCH",
      url: "/api/account",
      cookies: { session: token },
      payload: { dailyLimit: 25, weeklyLimit: 100 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ success: true });
  });
});
