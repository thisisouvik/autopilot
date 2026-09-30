export default function Loading() {
  return (
    <div className="p-6 md:p-8 space-y-6 w-full max-w-7xl mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-8 bg-white/[0.06] rounded-xl w-48 skeleton-shimmer" />
        <div className="h-9 bg-white/[0.06] rounded-xl w-32 skeleton-shimmer" />
      </div>

      {/* Metric Tiles skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-28 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 skeleton-shimmer"
          />
        ))}
      </div>

      {/* Main card skeleton */}
      <div className="h-72 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 skeleton-shimmer" />
    </div>
  );
}

