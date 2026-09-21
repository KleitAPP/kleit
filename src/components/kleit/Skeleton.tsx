import { cn } from "@/lib/utils";
import { t } from "@/i18n/en";

/** Grey block in the exact shape of what is coming (design pack §7.1 #2). Stops shimmering under reduce-motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("kl-skeleton rounded-sm bg-surface-2", className)} />;
}

export function SetCardSkeleton() {
  return (
    <div role="status" aria-label={t("loading")} className="rounded-md bg-surface p-3 shadow-card">
      <Skeleton className="aspect-square w-full" />
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="size-8 rounded-pill" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}

export function ItemCardSkeleton() {
  return (
    <div role="status" aria-label={t("loading")}>
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      <Skeleton className="mt-1 h-4 w-1/3" />
    </div>
  );
}
