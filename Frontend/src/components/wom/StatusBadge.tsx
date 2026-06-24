import { cn } from "@/lib/utils";

export function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const map: Record<string, string> = {
    "Expired / overdue": "bg-destructive/10 text-destructive border-destructive/20",
    "Mid-cycle service opportunity": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Within lifecycle": "bg-sky-500/10 text-sky-600 border-sky-500/20",
    "Due within 12 months": "bg-warning/10 text-warning border-warning/20",
    "Manual review": "bg-muted text-muted-foreground border-border/60",
    "Due soon": "bg-warning/10 text-warning border-warning/20",
    Reviewed: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  };

  const shortTextMap: Record<string, string> = {
    "Expired / overdue": "Overdue",
    "Mid-cycle service opportunity": "Mid-Cycle",
    "Within lifecycle": "Active",
    "Due within 12 months": "Due < 12M",
    "Manual review": "Review",
    "Due soon": "Due Soon",
    Reviewed: "Reviewed",
  };

  const cls = map[status] ?? "bg-muted text-muted-foreground border-border/60";
  const text = compact ? (shortTextMap[status] ?? status) : status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-bold uppercase tracking-wider shrink-0",
        compact ? "px-1.5 py-0.5 text-[8px] tracking-normal" : "px-3 py-1 text-[10px] tracking-wider",
        cls,
      )}
      title={status}
    >
      <span className="size-1 rounded-full bg-current animate-pulse shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function PriorityChip({ priority, compact = false }: { priority: string; compact?: boolean }) {
  const map: Record<string, string> = {
    High: "bg-primary/10 text-primary border-primary/20",
    Low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "Manual review": "bg-muted text-muted-foreground border-border/60",
  };

  const shortTextMap: Record<string, string> = {
    High: "High",
    Low: "Low",
    "Manual review": "Review",
  };

  const text = compact ? (shortTextMap[priority] ?? priority) : priority;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-bold uppercase tracking-wider shrink-0",
        compact ? "px-1.5 py-0.5 text-[8px] tracking-normal" : "px-3 py-1 text-[10px] tracking-wider",
        map[priority] ?? "bg-muted text-muted-foreground border-border/60",
      )}
      title={priority}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}

