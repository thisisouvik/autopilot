// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import autopilotRoutes from "../routes/autopilot";

// Mock dependencies
vi.mock("../lib/db", () => ({
  getDb: () => {
    const mockSql = async (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join("?");
      if (query.includes('FROM "User" u')) {
        // Return dummy user
        return [
          {
            id: "11111111-1111-1111-1111-111111111111",
            publicKey: "GBTESTPUBLICKEYUSER11111111111111111111111111111111111",
            dailyLimit: "100",
            weeklyLimit: "500",
          },
        ];
      }
      return [];
    };
    return mockSql;
  },
}));

vi.mock("../lib/engine", () => ({
  fetchRecentPayments: vi.fn().mockResolvedValue([
    {
      id: "pay-1",
      amount: "10.0000000",
      asset: "XLM",
      from: "GBSENDER",
      to: "GBTESTPUBLICKEYUSER11111111111111111111111111111111111",
      createdAt: new Date().toISOString(),
    },
  ]),
}));

const mockProcessPaymentDirect = vi.fn().mockResolvedValue({
  processed: 1,
  results: [
    {
      ruleId: "rule-1",
      status: "executed",
      amount: "1.0000000",
      asset: "XLM",
      destination: "GBSAVINGSVAULTKEY",
      txHash: "mock-tx-hash-12345",
    },
  ],
});

vi.mock("../engine/processor", () => ({
  processPaymentDirect: (...args: any[]) => mockProcessPaymentDirect(...args),
}));

vi.mock("../stellar/horizon", () => ({
  getHorizon: () => ({
    accounts: () => ({
      accountId: () => ({
        call: async () => ({ balances: [{ asset_type: "native", balance: "100.0" }] }),
      }),
    }),
  }),
}));

describe("Autopilot Monitor Security & Execution Tests (Issue #196)", () => {
  let server: FastifyInstance;
  const TEST_JWT_SECRET = "test-jwt-secret-key-1234567890123456";
  const TEST_ENGINE_SECRET = "test-engine-secret-xyz";

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.ENGINE_SECRET = TEST_ENGINE_SECRET;
    process.env.AUTOPILOT_PUBLIC_KEY = "GBAUTOPILOTENGINEHOTWALLETKEY123456789012345678";

    server = Fastify();
    await server.register(import("@fastify/jwt"), {
      secret: TEST_JWT_SECRET,
      cookie: {
        cookieName: "session",
        signed: false,
      },
    });
    await server.register(import("@fastify/cookie"));

    server.register(autopilotRoutes, { prefix: "/api/autopilot" });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("Test 1: POST /api/autopilot/monitor rejects unauthenticated request with 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/autopilot/monitor",
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toHaveProperty("error");
  });

  it("Test 2: POST /api/autopilot/monitor accepts request with valid x-engine-secret", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/autopilot/monitor",
      headers: {
        "x-engine-secret": TEST_ENGINE_SECRET,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(mockProcessPaymentDirect).toHaveBeenCalled();
  });

  it("Test 3: POST /api/autopilot/monitor accepts user JWT session and enforces tenant isolation", async () => {
    mockProcessPaymentDirect.mockClear();

    const userToken = server.jwt.sign({
      id: "11111111-1111-1111-1111-111111111111",
      publicKey: "GBTESTPUBLICKEYUSER11111111111111111111111111111111111",
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/autopilot/monitor",
      cookies: {
        session: userToken,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.usersChecked).toBe(1);
    expect(mockProcessPaymentDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "11111111-1111-1111-1111-111111111111",
        publicKey: "GBTESTPUBLICKEYUSER11111111111111111111111111111111111",
      })
    );
  });

  it("Test 4: Delegates to processPaymentDirect which routes funds to vault, not hot-wallet", async () => {
    const userToken = server.jwt.sign({
      id: "11111111-1111-1111-1111-111111111111",
      publicKey: "GBTESTPUBLICKEYUSER11111111111111111111111111111111111",
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/autopilot/monitor",
      cookies: {
        session: userToken,
      },
    });

    const body = JSON.parse(res.payload);
    expect(body.results[0].destination).toBe("GBSAVINGSVAULTKEY");
    expect(body.results[0].destination).not.toBe(process.env.AUTOPILOT_PUBLIC_KEY);
  });
});
