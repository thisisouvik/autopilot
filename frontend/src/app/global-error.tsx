"use client";

import { AlertOctagon, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark bg-black text-white h-full antialiased">
      <body className="min-h-full flex items-center justify-center p-6 bg-black text-white">
        <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertOctagon className="w-6 h-6 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Critical Application Error</h2>
          <p className="text-sm text-white/50 mb-6 leading-relaxed">
            {error?.message || "An unexpected error occurred. Please reload the application."}
          </p>
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-semibold rounded-xl transition duration-150 shadow-lg shadow-blue-500/20"
          >
            <RotateCcw className="w-4 h-4" />
            Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}

