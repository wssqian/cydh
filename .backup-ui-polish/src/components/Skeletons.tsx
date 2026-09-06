import { ChevronRight } from "lucide-react";

export function ResourceCardSkeleton() {
  return (
    <div className="resource-card flex items-center gap-3 rounded-2xl p-4 glass-card">
      <div className="resource-card-icon w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0 relative overflow-hidden">
         <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-4 w-24 rounded bg-slate-100 dark:bg-slate-800 animate-pulse relative overflow-hidden mb-1.5">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
        <div className="h-3 w-32 rounded bg-slate-50 dark:bg-slate-800/50 animate-pulse relative overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>
      <div className="resource-card-chevron text-slate-100 dark:text-slate-800 shrink-0">
        <ChevronRight className="w-4 h-4" />
      </div>
    </div>
  );
}

export function CategorySkeleton() {
  return (
    <div className="liquid-panel flex flex-col items-center justify-center p-6 rounded-2xl">
       <div className="h-5 w-20 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
    </div>
  );
}
