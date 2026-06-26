"use client";

import { useState, useRef, useEffect } from "react";

import {
  Send,
  Sparkles,
  Bot,
  User,
  Zap,
  Clock,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Edit3,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ────────────────────────────────────────────────────────────────────
interface ParsedRule {
  trigger: string;
  action: string;
  amount: number;
  isPercentage: boolean;
  limits: { maxPerMonth: number | null };
  description: string;
  memo: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  rule?: ParsedRule;
  isConfirmation?: boolean;
  isError?: boolean;
}

// ── Suggestion chips ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { label: "Save 10% of every payment", icon: "💰" },
  { label: "Invest 5 XLM weekly", icon: "📈" },
  { label: "Keep 200 XLM buffer", icon: "🛡️" },
];

// ── Rule Preview Card ─────────────────────────────────────────────────────────
function RuleCard({
  rule,
  onActivate,
  onEdit,
  activating,
  activated,
}: {
  rule: ParsedRule;
  onActivate: () => void;
  onEdit: () => void;
  activating: boolean;
  activated: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="mt-3 border border-blue-500/25 rounded-2xl overflow-hidden bg-gradient-to-b from-blue-500/[0.07] to-transparent"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-blue-500/20 flex items-center justify-center">
          <Zap className="w-3 h-3 text-blue-400" />
        </div>
        <span className="text-xs font-semibold text-blue-400 tracking-wider uppercase">
          Rule Preview
        </span>
      </div>

      {/* Fields */}
      <div className="px-4 py-4 space-y-3">
        <RuleField icon={<Clock className="w-3.5 h-3.5" />} label="TRIGGER" value={rule.trigger} />
        <RuleField icon={<Zap className="w-3.5 h-3.5" />} label="ACTION" value={rule.action} />
        <RuleField
          icon={<DollarSign className="w-3.5 h-3.5" />}
          label="AMOUNT"
          value={
            rule.isPercentage
              ? `${rule.amount}% of each payment`
              : `${rule.amount} XLM`
          }
        />
        {rule.limits?.maxPerMonth && (
          <RuleField
            icon={<AlertCircle className="w-3.5 h-3.5" />}
            label="LIMIT"
            value={`Max ${rule.limits.maxPerMonth} XLM / month`}
          />
        )}
      </div>

      {/* Description */}
      <div className="px-4 pb-4">
        <p className="text-xs text-white/40 italic">{rule.description}</p>
      </div>

      {/* Actions */}
      {!activated && (
        <div className="px-4 pb-4 flex gap-2">
          <button
            onClick={onActivate}
            disabled={activating}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-60"
          >
            {activating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {activating ? "Activating…" : "Activate Rule"}
          </button>
          <button
            onClick={onEdit}
            disabled={activating}
            className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] text-white/60 hover:text-white text-sm font-medium transition-all border border-white/[0.08]"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>
      )}

      {activated && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 py-2.5 px-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Rule activated — AutoPilot is watching
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RuleField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-white/25 shrink-0">{icon}</div>
      <div>
        <p className="text-[10px] font-semibold text-white/30 tracking-widest uppercase leading-none mb-1">
          {label}
        </p>
        <p className="text-sm text-white/80">{value}</p>
      </div>
    </div>
  );
}

// ── Chat Bubble ──────────────────────────────────────────────────────────────
function ChatBubble({ msg, onActivate, onEdit }: {
  msg: Message;
  onActivate?: (rule: ParsedRule) => void;
  onEdit?: (rule: ParsedRule) => void;
}) {
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const handleActivate = async () => {
    if (!msg.rule || !onActivate) return;
    setActivating(true);
    await onActivate(msg.rule);
    setActivating(false);
    setActivated(true);
  };

  const handleEdit = () => {
    if (msg.rule && onEdit) onEdit(msg.rule);
  };

  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${
          isUser
            ? "bg-gradient-to-br from-blue-500 to-purple-600"
            : "bg-white/[0.07] border border-white/[0.10]"
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-white" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-white/60" />
        )}
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-blue-600/80 text-white rounded-tr-sm"
              : msg.isError
              ? "bg-red-500/10 border border-red-500/20 text-red-300 rounded-tl-sm"
              : msg.isConfirmation
              ? "bg-green-500/10 border border-green-500/20 text-green-300 rounded-tl-sm"
              : "bg-white/[0.05] border border-white/[0.08] text-white/80 rounded-tl-sm"
          }`}
        >
          {msg.content}
        </div>

        {msg.rule && onActivate && onEdit && (
          <RuleCard
            rule={msg.rule}
            onActivate={handleActivate}
            onEdit={handleEdit}
            activating={activating}
            activated={activated}
          />
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.rule) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.error ?? "Sorry, I couldn't parse that. Try rephrasing your request.",
            isError: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Here's the automation rule I've created for you:`,
            rule: data.rule,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Network error. Please check your connection and try again.",
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (rule: ParsedRule) => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });

      if (res.ok) {
        setToast("Rule activated — AutoPilot is watching 👁");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "✅ Rule activated! AutoPilot will now monitor your wallet and execute this rule automatically. Want to create another rule?",
            isConfirmation: true,
          },
        ]);
      } else {
        setToast("Failed to activate rule. Please try again.");
      }
    } catch {
      setToast("Network error activating rule.");
    }
  };

  const handleEdit = (rule: ParsedRule) => {
    setInput(rule.description ?? `${rule.action} ${rule.amount}${rule.isPercentage ? "%" : " XLM"} ${rule.trigger.toLowerCase()}`);
  };

  const isEmpty = messages.length === 0;

  return (
      <div className="flex flex-col h-screen md:h-screen relative">
        {/* ── Toast ── */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-black border border-white/15 text-white text-sm px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-xl whitespace-nowrap"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Header ── */}
        <div className="flex-shrink-0 px-6 py-5 border-b border-white/[0.06] bg-black/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">AutoPilot AI</h1>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
                <span className="text-[11px] text-white/35">Powered by Gemini 2.0 Flash</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {isEmpty ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center justify-center h-full text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20 flex items-center justify-center mb-5">
                <Sparkles className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">
                What should AutoPilot do?
              </h2>
              <p className="text-sm text-white/35 max-w-xs mb-8">
                Describe your financial goal in plain English. I'll turn it into an automation rule.
              </p>

              {/* Suggestion chips */}
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => sendMessage(s.label)}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.14] text-sm text-white/60 hover:text-white/90 transition-all text-left"
                  >
                    <span className="text-lg leading-none">{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  msg={msg}
                  onActivate={handleActivate}
                  onEdit={handleEdit}
                />
              ))}

              {/* Loading indicator */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="w-7 h-7 rounded-full bg-white/[0.07] border border-white/[0.10] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-white/60" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white/[0.05] border border-white/[0.08]">
                    <div className="flex gap-1 items-center">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-white/40"
                          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                          transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Input Bar ── */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-white/[0.06] bg-black/50 backdrop-blur-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex items-end gap-3"
          >
            <div className="flex-1 relative">
              <textarea
                id="chat-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Describe your automation goal…"
                rows={1}
                disabled={loading}
                className="w-full bg-white/[0.05] border border-white/[0.10] rounded-2xl px-4 py-3 text-sm text-white placeholder-white/25 resize-none overflow-hidden focus:outline-none focus:border-blue-500/40 focus:bg-white/[0.07] transition-all disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              id="chat-send-btn"
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-all"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </button>
          </form>
          <p className="text-[11px] text-white/20 mt-2 text-center">
            Shift+Enter for new line · Enter to send
          </p>
        </div>
      </div>
  );
}
