// @ts-nocheck
import { FastifyInstance } from "fastify";
import { HORIZON_URL, getHorizon } from "../stellar/horizon";
import { getDb } from "../lib/db";
import { getRedis } from "../lib/redis";

type DependencyStatus = "ok" | "degraded" | "down";

interface DependencyCheck {
  status: DependencyStatus;
  detail?: string;
}

interface EngineCheck extends DependencyCheck {
  exists: boolean;
  balanceXlm: number | null;
  minimumBalanceXlm: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MIN_ENGINE_BALANCE_XLM = 3;

function configuredNumber(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, dependency: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${dependency} health check timed out`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkDatabase(timeoutMs: number): Promise<DependencyCheck> {
  try {
    const sql = getDb();
    await withTimeout(sql`SELECT 1 AS healthy`, timeoutMs, "database");
    return { status: "ok" };
  } catch {
    return { status: "down", detail: "Database query failed" };
  }
}

async function checkHorizon(timeoutMs: number): Promise<DependencyCheck> {
  try {
    const response = await withTimeout(fetch(HORIZON_URL), timeoutMs, "Horizon");
    if (!response.ok) {
      return { status: "down", detail: `Horizon returned HTTP ${response.status}` };
    }
    return { status: "ok" };
  } catch {
    return { status: "down", detail: "Horizon is unreachable" };
  }
}

async function checkRedis(timeoutMs: number): Promise<DependencyCheck> {
  const redis = getRedis();
  if (!redis) {
    return { status: "degraded", detail: "Redis is not configured" };
  }

  try {
    const response = await withTimeout(redis.ping(), timeoutMs, "Redis");
    if (String(response).toUpperCase() !== "PONG") {
      return { status: "degraded", detail: "Redis returned an unexpected response" };
    }
    return { status: "ok" };
  } catch {
    return { status: "degraded", detail: "Redis ping failed" };
  }
}

async function checkEngineAccount(
  timeoutMs: number,
  minimumBalanceXlm: number,
): Promise<EngineCheck> {
  const publicKey = process.env.AUTOPILOT_PUBLIC_KEY;
  if (!publicKey) {
    return {
      status: "degraded",
      detail: "AUTOPILOT_PUBLIC_KEY is not configured",
      exists: false,
      balanceXlm: null,
      minimumBalanceXlm,
    };
  }

  try {
    const account = await withTimeout(
      getHorizon().accounts().accountId(publicKey).call(),
      timeoutMs,
      "engine account",
    );
    const nativeBalance = account.balances.find((balance: any) => balance.asset_type === "native");
    const balanceXlm = Number(nativeBalance?.balance ?? 0);
    const hasMinimumBalance = balanceXlm >= minimumBalanceXlm;

    return {
      status: hasMinimumBalance ? "ok" : "degraded",
      detail: hasMinimumBalance
        ? undefined
        : `Engine balance is below ${minimumBalanceXlm.toFixed(2)} XLM`,
      exists: true,
      balanceXlm,
      minimumBalanceXlm,
    };
  } catch (error: any) {
    const notFound = error?.response?.status === 404;
    return {
      status: "degraded",
      detail: notFound ? "Engine account does not exist on the active network" : "Engine account check failed",
      exists: false,
      balanceXlm: null,
      minimumBalanceXlm,
    };
  }
}

export default async function healthRoutes(server: FastifyInstance) {
  server.get("/health", async (_: any, reply: any) => {
    const timeoutMs = configuredNumber("HEALTH_CHECK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1);
    const minimumBalanceXlm = configuredNumber(
      "MIN_ENGINE_BALANCE_XLM",
      DEFAULT_MIN_ENGINE_BALANCE_XLM,
      0,
    );

    const [db, horizon, redis, engine] = await Promise.all([
      checkDatabase(timeoutMs),
      checkHorizon(timeoutMs),
      checkRedis(timeoutMs),
      checkEngineAccount(timeoutMs, minimumBalanceXlm),
    ]);

    const criticalDependencyDown = db.status === "down" || horizon.status === "down";
    const statusCode = criticalDependencyDown ? 503 : 200;

    reply.header("Cache-Control", "no-store");
    return reply.status(statusCode).send({
      status: criticalDependencyDown ? "degraded" : "ok",
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      db: db.status,
      horizon: horizon.status,
      redis: redis.status,
      engine: engine.status,
      engine_balance: engine.balanceXlm === null ? "N/A" : `${engine.balanceXlm.toFixed(2)} XLM`,
      checks: { db, horizon, redis, engine },
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    });
  });
}

