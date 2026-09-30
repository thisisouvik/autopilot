export default function Loading() {
  return (
    <div className="p-6 md:p-8 space-y-6 w-full max-w-7xl mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-white/[0.06] rounded-xl w-40 skeleton-shimmer" />
          <div className="h-4 bg-white/[0.04] rounded-lg w-64 skeleton-shimmer" />
        </div>
        <div className="h-10 bg-white/[0.06] rounded-xl w-32 skeleton-shimmer" />
      </div>

      {/* Goal Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-48 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 skeleton-shimmer"
          />
        ))}
      </div>
    </div>
  );
}

