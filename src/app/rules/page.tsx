import DashboardShell from "@/components/DashboardShell";
import { getSession } from "@/lib/session";
import { neon } from "@neondatabase/serverless";
import {
  Zap,
  Sparkles,
  CheckCircle2,
  PauseCircle,
  DollarSign,
  Calendar,
  Clock,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
        isActive
          ? "bg-green-500/10 text-green-400 border border-green-500/20"
          : "bg-white/[0.05] text-white/30 border border-white/[0.08]"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isActive ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-white/20"
        }`}
      />
      {isActive ? "Active" : "Paused"}
    </span>
  );
}

function RuleRow({ rule }: { rule: any }) {
  const actionIconMap: Record<string, React.ElementType> = {
    Save: DollarSign,
    Invest: TrendingUp,
    Buffer: Clock,
    Transfer: ChevronRight,
  };
  const Icon = actionIconMap[rule.action] ?? Zap;

  const accentMap: Record<string, string> = {
    Save: "text-green-400 bg-green-500/10 border-green-500/20",
    Invest: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    Buffer: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    Transfer: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  };
  const accent = accentMap[rule.action] ?? "text-white/50 bg-white/[0.05] border-white/[0.08]";

  return (
    <div className="flex items-start gap-4 px-6 py-5 border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${accent}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white/90">
              {rule.description ?? `${rule.action} ${rule.amount}${rule.isPercentage ? "%" : " XLM"}`}
            </p>
            <p className="text-xs text-white/35 mt-0.5">{rule.trigger}</p>
          </div>
          <StatusBadge status={rule.status} />
        </div>

        <div className="flex items-center gap-4 mt-3">
          <span className="flex items-center gap-1.5 text-xs text-white/30">
            <DollarSign className="w-3 h-3" />
            {rule.amount}{rule.isPercentage ? "% per trigger" : " XLM per trigger"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-white/25">
            <Calendar className="w-3 h-3" />
            {new Date(rule.createdAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default async function RulesPage() {
  const session = await getSession();
  const sql = neon(process.env.DATABASE_URL!);

  const rules = await sql`
    SELECT r.* FROM "Rule" r
    JOIN "User" u ON r."userId" = u.id
    WHERE u."publicKey" = ${session.publicKey}
    ORDER BY r."createdAt" DESC
  `;

  const activeCount = rules.filter((r: any) => r.status === "active").length;

  return (
    <DashboardShell publicKey={session.publicKey}>
      <div className="px-6 py-8 max-w-3xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Rules</h1>
            <p className="text-sm text-white/35 mt-1">
              {rules.length === 0
                ? "No automation rules yet"
                : `${activeCount} active · ${rules.length - activeCount} paused`}
            </p>
          </div>
          <Link
            href="/chat"
            id="new-rule-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all"
          >
            <Sparkles className="w-4 h-4" />
            New Rule
          </Link>
        </div>

        {rules.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "Total Rules", value: rules.length, icon: Zap },
              { label: "Active", value: activeCount, icon: CheckCircle2 },
              { label: "Paused", value: rules.length - activeCount, icon: PauseCircle },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4 text-center">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-white/35 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-5">
                <Zap className="w-6 h-6 text-white/20" />
              </div>
              <p className="text-sm font-semibold text-white/50">No rules yet</p>
              <p className="text-xs text-white/25 mt-1.5 max-w-xs">
                Create your first automation rule using AutoPilot AI. Just describe what you want in plain English.
              </p>
              <Link
                href="/chat"
                className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Create first rule
              </Link>
            </div>
          ) : (
            <div>
              <div className="px-6 py-3.5 border-b border-white/[0.05]">
                <p className="text-xs font-semibold text-white/25 uppercase tracking-wider">All Rules</p>
              </div>
              {rules.map((rule: any) => <RuleRow key={rule.id} rule={rule} />)}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
