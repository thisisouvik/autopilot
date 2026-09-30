export default function Loading() {
  return (
    <div className="p-6 md:p-8 space-y-6 w-full max-w-5xl mx-auto flex flex-col h-[calc(100vh-5rem)]">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-white/[0.06] skeleton-shimmer" />
        <div className="space-y-1.5">
          <div className="h-5 bg-white/[0.06] rounded-lg w-32 skeleton-shimmer" />
          <div className="h-3 bg-white/[0.04] rounded-md w-48 skeleton-shimmer" />
        </div>
      </div>

      {/* Chat messages skeleton */}
      <div className="flex-1 space-y-4 py-4">
        <div className="h-20 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 w-3/4 skeleton-shimmer" />
        <div className="h-16 bg-white/[0.05] border border-white/[0.08] rounded-2xl p-4 w-2/3 ml-auto skeleton-shimmer" />
        <div className="h-24 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 w-4/5 skeleton-shimmer" />
      </div>

      {/* Input skeleton */}
      <div className="h-14 bg-white/[0.03] border border-white/[0.06] rounded-2xl skeleton-shimmer" />
    </div>
  );
}

