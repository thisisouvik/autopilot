/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import EngineStatusPanel from "@/components/EngineStatusPanel";
import {
  TrendingUp,
  Shield,
  Activity,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  Sparkles,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { horizonAccountUrl, IS_TESTNET, NETWORK_LABEL } from "@/lib/network";

// ── Metric Tile ─────────────────────────────────────────────────────────────
// Static lookup map — full class strings must be present as unbroken literals
// so Tailwind's JIT scanner includes them in the production bundle.
const ACCENT_CLASSES = {
  green:  { bg: "bg-green-500/10  border-green-500/20",  text: "text-green-500"  },
  blue:   { bg: "bg-blue-500/10   border-blue-500/20",   text: "text-blue-500"   },
  purple: { bg: "bg-purple-500/10 border-purple-500/20", text: "text-purple-500" },
  amber:  { bg: "bg-amber-500/10  border-amber-500/20",  text: "text-amber-500"  },
} as const;

type AccentKey = keyof typeof ACCENT_CLASSES;

function MetricTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent: AccentKey;
}) {
  const { bg, text } = ACCENT_CLASSES[accent];
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/30 font-medium">{label}</p>
        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${bg}`}>
          <Icon className={`w-3.5 h-3.5 ${text}`} />
        </div>
      </div>
      <p className="text-xl font-bold text-white [overflow-wrap:anywhere]">{value}</p>
      {sub && <p className="text-xs text-white/25 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Activity Item ────────────────────────────────────────────────────────────
function ActivityItem({
  type,
  memo,
  amount,
  createdAt,
  asset = "XLM",
}: {
  type: string;
  memo: string | null;
  amount: number;
  createdAt: string;
  /** Rows written before asset tracking existed are XLM. */
  asset?: string;
}) {
  const isIncoming = type === "save" || type === "invest";
  return (
    <div className="flex items-center gap-4 py-4 border-b border-white/[0.04] last:border-0">
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
          isIncoming
            ? "bg-green-500/10 text-green-400"
            : "bg-red-500/10 text-red-400"
        }`}
      >
        {isIncoming ? (
          <ArrowDownLeft className="w-4 h-4" />
        ) : (
          <ArrowUpRight className="w-4 h-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white/70 capitalize">{type}</p>
        <p className="text-[10px] text-white/30 truncate">
          {memo ?? "AutoPilot rule triggered"}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold text-white/60 whitespace-nowrap">
          {Number(amount).toFixed(4)}{" "}
          <span className={asset === "USDC" ? "text-emerald-300/70" : undefined}>{asset}</span>
        </p>
        <p className="text-[10px] text-white/25">
          {new Date(createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

function EmptyActivity({ hasActiveRules }: { hasActiveRules: boolean }) {
  return (
    <div className="py-10 text-center">
      <div className="w-10 h-10 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
        <Activity className="w-5 h-5 text-white/20" />
      </div>
      <p className="text-sm text-white/40 font-medium">No automated transactions yet</p>
      <p className="text-xs text-white/25 mt-1 max-w-sm mx-auto leading-relaxed">
        {hasActiveRules
          ? "Your saves and investments will appear here after an incoming payment matches a rule."
          : "Create a rule, then send a payment to your wallet to see AutoPilot work."}
      </p>
      <Link
        href={hasActiveRules ? "/rules" : "/chat"}
        className="mt-4 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium justify-center"
      >
        {hasActiveRules ? <Zap className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
        {hasActiveRules ? "Review active rules" : "Create your first rule"}
      </Link>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState("");
  const [xlmBalance, setXlmBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [hasUsdcTrustline, setHasUsdcTrustline] = useState(false);
  const [isUnfunded, setIsUnfunded] = useState(false);
  const [txRows, setTxRows] = useState<any[]>([]);
  const [activeRules, setActiveRules] = useState(0);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  const copyAddress = async () => {
    if (!publicKey) return;
    await navigator.clipboard.writeText(publicKey);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  useEffect(() => {
    async function loadDashboard() {
      try {
        // Try to load account (if cookie is not set → redirect to onboarding)
        const [accountRes, txRes] = await Promise.all([
          fetch("/api/account?limit=10"),
          fetch("/api/transactions?limit=10"),
        ]);

        if (accountRes.status === 401) {
          router.push("/onboarding");
          return;
        }

        // Safe JSON parse — avoids crash when server returns a 500 HTML body
        const safeJson = async (res: Response) => {
          if (!res.ok) return null;
          try { return await res.json(); } catch { return null; }
        };

        const account  = await safeJson(accountRes);
        const txData   = await safeJson(txRes);

        if (!account) {
          // Not logged in or backend error — stop loading so the dashboard
          // never hangs on the spinner at startup.
          setLoading(false);
          return;
        }

        const userPublicKey = account.publicKey ?? "";
        setPublicKey(userPublicKey);
        setLastSeen(account.lastSeen ?? null);
        setActiveRules(account.activeRules ?? 0);
        const transactions = Array.isArray(txData) ? txData : (txData?.transactions ?? []);
        setTxRows(transactions);

        // Fetch the USER's own live Stellar balance from Horizon
        if (userPublicKey) {
          try {
            const horizonRes = await fetch(
              horizonAccountUrl(userPublicKey)
            );
            if (horizonRes.ok) {
              const horizonData = await horizonRes.json();
              const balances = horizonData.balances ?? [];
              const native = balances.find((b: any) => b.asset_type === "native");
              setXlmBalance(native?.balance ?? "0");
              // USDC is held via a trustline, so it appears as a credit_alphanum4
              // entry rather than the native balance.
              const usdc = balances.find((b: any) => b.asset_code === "USDC");
              setUsdcBalance(usdc?.balance ?? "0");
              setHasUsdcTrustline(Boolean(usdc));
              setIsUnfunded(false);
            } else {
              // 404 = account not funded yet on testnet
              setXlmBalance("0");
              setUsdcBalance("0");
              setIsUnfunded(true);
            }
          } catch {
            setXlmBalance("0");
            setUsdcBalance("0");
          }
        }
      } catch (err) {
        console.error("Dashboard load error:", err);
      }

      setLoading(false);
    }

    loadDashboard();

    // Auto-refresh every 30 seconds so balance and activity stay live
    const interval = setInterval(loadDashboard, 30_000);
    return () => clearInterval(interval);
  }, [router]);


  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Totals are per-asset: summing XLM and USDC amounts into one figure would be
  // meaningless, since they are different currencies at different prices.
  const sumByAsset = (rows: any[], asset: string) =>
    rows
      .filter((tx: any) => (tx.asset ?? "XLM") === asset)
      .reduce((sum: number, tx: any) => sum + Number(tx.amount), 0);

  const savedRows = txRows.filter(
    (tx: any) => tx.type === "save" && new Date(tx.createdAt) >= startOfMonth,
  );
  const investedRows = txRows.filter((tx: any) => tx.type === "invest");

  const savedThisMonth = sumByAsset(savedRows, "XLM");
  const savedThisMonthUsdc = sumByAsset(savedRows, "USDC");
  const totalInvested = sumByAsset(investedRows, "XLM");
  const totalInvestedUsdc = sumByAsset(investedRows, "USDC");

  const xlmNum = parseFloat(xlmBalance);
  const usdcNum = parseFloat(usdcBalance);
  // Rate compares like with like: XLM saved against the XLM balance.
  const savingsRate = xlmNum > 0 ? Math.min(Math.round((savedThisMonth / xlmNum) * 100), 100) : 0;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const shortKey = publicKey
    ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`
    : "…";

  if (loading) {
    return (
      <div className="flex min-h-screen bg-black items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-sm text-white/30">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell publicKey={publicKey}>
      <div className="px-4 py-6 md:px-6 md:py-8 max-w-5xl mx-auto w-full">
        {/* Notification Banner */}
        {lastSeen && txRows.filter((tx: any) => new Date(tx.createdAt) > new Date(lastSeen)).length > 0 && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Recent Automation Activity!</p>
                <p className="text-xs text-blue-200">{txRows.filter((tx: any) => new Date(tx.createdAt) > new Date(lastSeen)).length} automated transaction(s) ran since your last visit.</p>
              </div>
            </div>
            <button onClick={() => setLastSeen(new Date().toISOString())} className="text-xs font-medium text-blue-400 hover:text-blue-300">Dismiss</button>
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <p className="text-white/30 text-sm mb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-baseline gap-x-2 flex-wrap">
            <span>{greeting},</span>
            <span className="font-mono text-white/50 text-lg md:text-xl">{shortKey}</span>
          </h1>
        </div>

        {/* Balance Card */}
        <div className="relative bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.08] rounded-3xl p-5 md:p-7 mb-6 overflow-hidden">
          <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-40px] left-[20%] w-40 h-40 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-start justify-between gap-x-3 mb-6">
              <p className="text-white/40 text-[11px] font-medium tracking-widest uppercase shrink-0">
                Total Balance
              </p>
              <div className="flex items-center justify-end gap-x-2 gap-y-1 flex-wrap min-w-0">
                {isUnfunded && (
                  <span className="text-xs text-amber-400/70 bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                    Not funded
                  </span>
                )}
                <span className="text-xs text-blue-400/80 bg-blue-400/10 border border-blue-400/20 px-2.5 py-1 rounded-full font-medium whitespace-nowrap">
                  ✦ Stellar {NETWORK_LABEL}
                </span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 md:gap-3 mb-2 flex-wrap">
              <span className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight min-w-0 [overflow-wrap:anywhere]">
                {xlmNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-xl md:text-2xl font-medium text-white/30 whitespace-nowrap">XLM</span>
            </div>

            {/* USDC sits alongside XLM as a first-class balance. Shown whenever
                a trustline exists, including at zero, so the user can see the
                account is ready to receive USDC. */}
            {hasUsdcTrustline && (
              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                <span className="text-2xl md:text-3xl font-semibold text-emerald-300/90 tracking-tight min-w-0 [overflow-wrap:anywhere]">
                  {usdcNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-base md:text-lg font-medium text-emerald-300/40 whitespace-nowrap">USDC</span>
              </div>
            )}

            <p className="text-white/25 text-sm">
              {hasUsdcTrustline
                ? "Live XLM + USDC balances from Stellar Horizon API"
                : "Live balance from Stellar Horizon API"}
            </p>
          </div>
        </div>

        {isUnfunded && publicKey && (
          <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-amber-300" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">Fund your wallet to get started</p>
              <p className="text-xs text-white/40 mt-1 leading-relaxed">
                {IS_TESTNET
                  ? "Your Stellar testnet account does not exist on-chain yet. Add test XLM before creating and running automations."
                  : "Send XLM to this address to activate the account before running automations."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={copyAddress}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs text-white/60 transition-colors"
              >
                {copiedAddress ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedAddress ? "Copied" : "Copy address"}
              </button>
              {IS_TESTNET && (
                <a
                  href={`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-400 text-black text-xs font-semibold hover:bg-amber-300 transition-colors"
                >
                  Fund with Friendbot <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* USDC totals are surfaced in the subtitle rather than as separate
              tiles, so the row stays four wide and only mentions USDC when
              automation has actually moved some. */}
          <MetricTile
            label="Saved this month"
            value={`${savedThisMonth.toFixed(2)} XLM`}
            sub={savedThisMonthUsdc > 0 ? `+ ${savedThisMonthUsdc.toFixed(2)} USDC` : "via active rules"}
            icon={Shield}
            accent="green"
          />
          <MetricTile label="Active rules" value={String(activeRules)} sub={activeRules === 0 ? "Create your first" : "automations running"} icon={Zap} accent="blue" />
          <MetricTile
            label="Invested"
            value={`${totalInvested.toFixed(2)} XLM`}
            sub={totalInvestedUsdc > 0 ? `+ ${totalInvestedUsdc.toFixed(2)} USDC` : "total automated"}
            icon={TrendingUp}
            accent="purple"
          />
          <MetricTile label="Savings rate" value={`${savingsRate}%`} sub="of XLM balance saved" icon={Activity} accent="amber" />
        </div>

        {/* Activity Feed */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-white/[0.06]">
            <div>
              <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
              <p className="text-xs text-white/30 mt-0.5">Last 10 automated transactions</p>
            </div>
            <Link href="/rules" className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors">
              View rules <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="px-4 md:px-6">
            {txRows.length === 0 ? (
              <EmptyActivity hasActiveRules={activeRules > 0} />
            ) : (
              txRows.map((tx: any) => (
                <ActivityItem key={tx.id} type={tx.type} memo={tx.memo} amount={tx.amount} createdAt={tx.createdAt} asset={tx.asset ?? "XLM"} />
              ))
            )}
          </div>
        </div>

        {/* CTA if no rules */}
        {activeRules === 0 && (
          <Link href="/chat">
            <div className="mt-6 flex items-center justify-between p-5 bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-2xl hover:border-blue-500/40 transition-all group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Create your first automation rule</p>
                  <p className="text-xs text-white/40 mt-0.5">Tell AutoPilot what to do in plain English</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white/50 transition-colors" />
            </div>
          </Link>
        )}
        <EngineStatusPanel />
      </div>
    </DashboardShell>
  );
}
