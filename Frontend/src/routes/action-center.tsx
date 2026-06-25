import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchActions,
  fetchRecommendations,
  createAction,
  patchAction,
  deleteAction,
  addComment,
  deleteComment,
  suggestNextSteps,
} from "@/lib/api";
import type { Action, ActionStatus, ActionComment } from "@/lib/api";
import type { Recommendation } from "@/lib/wom-data";
import { groupSerialsByPart } from "@/lib/wom-data";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bell,
  Settings,
  LogOut,
  User,
  Plus,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock3,
  Trash2,
  ChevronRight,
  ChevronDown,
  Send,
  LayoutGrid,
  Zap,
  Filter,
  AlertTriangle,
  CalendarClock,
  Building2,
  Sparkles,
  Wrench,
  Hash,
  FileText,
  TicketIcon,
  Search,
  Eye,
  EyeOff,
  ShieldAlert,
  Package,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { NotificationBell } from "@/components/wom/NotificationBell";
import { MetricCard } from "@/components/wom/HomeTab";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

export const Route = createFileRoute("/action-center")({
  component: ActionCenter,
});

// ─── Mock monthly trend data ─────────────────────────────────────────────────
const MONTHLY_TREND = [
  { month: "Dec", failed: 4, closed: 9, in_progress: 6 },
  { month: "Jan", failed: 6, closed: 14, in_progress: 8 },
  { month: "Feb", failed: 3, closed: 11, in_progress: 10 },
  { month: "Mar", failed: 7, closed: 16, in_progress: 7 },
  { month: "Apr", failed: 5, closed: 12, in_progress: 9 },
  { month: "May", failed: 8, closed: 18, in_progress: 11 },
];

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-surface shadow-xl shadow-black/10 p-3.5 min-w-[148px]">
      <p className="text-xs font-bold text-foreground mb-2.5 border-b border-border/40 pb-2">
        {label}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-6 text-xs py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full shrink-0" style={{ background: entry.fill }} />
            {entry.name}
          </span>
          <span className="font-bold text-foreground tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function MonthlyTrendChart({ actions }: { actions: Action[] }) {
  const [range, setRange] = useState<1 | 3 | 6>(1);

  // Replace May entry with real data derived from actual actions
  const mayReal = useMemo(() => {
    const may = actions.filter((a) => (a.createdAt ?? "").startsWith("2026-05"));
    return {
      month: "May",
      failed: may.filter((a) => a.status === "failed").length,
      closed: may.filter((a) => a.status === "closed").length,
      in_progress: may.filter((a) => a.status === "in_progress").length,
    };
  }, [actions]);

  const trendData = useMemo(() => [...MONTHLY_TREND.slice(0, -1), mayReal], [mayReal]);

  const data = trendData.slice(-range);

  const totals = data.reduce(
    (acc, m) => ({
      failed: acc.failed + m.failed,
      closed: acc.closed + m.closed,
      in_progress: acc.in_progress + m.in_progress,
    }),
    { failed: 0, closed: 0, in_progress: 0 },
  );

  return (
    <div className="rounded-2xl border border-border/50 bg-surface/60 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-sm font-bold text-foreground">Monthly Action Trend</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Action outcomes over the selected period
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1">
          {([1, 3, 6] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-lg px-3 py-1 text-[11px] font-bold transition-all",
                range === r
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}M
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        {(
          [
            {
              label: "Total Failed",
              value: totals.failed,
              color: "text-red-400",
              bg: "bg-red-500/8",
              border: "border-red-500/20",
            },
            {
              label: "Total Closed",
              value: totals.closed,
              color: "text-emerald-400",
              bg: "bg-emerald-500/8",
              border: "border-emerald-500/20",
            },
            {
              label: "Total In-Progress",
              value: totals.in_progress,
              color: "text-orange-400",
              bg: "bg-orange-400/8",
              border: "border-orange-400/20",
            },
          ] as const
        ).map(({ label, value, color, bg, border }) => (
          <div key={label} className={cn("rounded-xl border p-3 text-center", bg, border)}>
            <p className={cn("text-2xl font-bold tabular-nums leading-none", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5 font-medium leading-tight">
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          barCategoryGap="32%"
          margin={{ top: 4, right: 4, left: -22, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.08)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)", fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <RechartsTooltip
            content={<TrendTooltip />}
            cursor={{ fill: "rgba(128,128,128,0.06)", radius: 4 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 16 }}
            iconType="circle"
            iconSize={7}
            formatter={(value) => (
              <span style={{ color: "var(--color-muted-foreground)", fontWeight: 500 }}>
                {value}
              </span>
            )}
          />
          <Bar
            dataKey="failed"
            name="Failed"
            fill="#ef4444"
            radius={[4, 4, 0, 0]}
            maxBarSize={16}
          />
          <Bar
            dataKey="closed"
            name="Closed"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
            maxBarSize={16}
          />
          <Bar
            dataKey="in_progress"
            name="In Progress"
            fill="#f97316"
            radius={[4, 4, 0, 0]}
            maxBarSize={16}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STATUS_META: Record<
  ActionStatus,
  { label: string; dot: string; badge: string; icon: React.ReactNode }
> = {
  in_progress: {
    label: "In Progress",
    dot: "bg-orange-500",
    badge: "border-orange-400/40 bg-orange-500/10 text-orange-400",
    icon: <Clock3 className="size-3.5" />,
  },
  closed: {
    label: "Closed",
    dot: "bg-emerald-500",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: <CheckCircle2 className="size-3.5" />,
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    badge: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: <XCircle className="size-3.5" />,
  },
};

function StatusBadge({ status }: { status: ActionStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        m.badge,
      )}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

function fmtDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDateShort(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// â”€â”€â”€ User menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// UserMenu component moved to __root.tsx layout wrapper

// â”€â”€â”€ Create Action Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CreateActionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ActionStatus>("in_progress");

  const mutation = useMutation({
    mutationFn: () =>
      createAction({ title: title.trim(), description: description.trim() || undefined, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      setTitle("");
      setDescription("");
      setStatus("in_progress");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-surface border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Plus className="size-4 text-primary" /> New Action
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Create a work order or action item to track follow-up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up on Shell recertification"
              className="bg-background/60 border-border/60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context…"
              rows={3}
              className="resize-none bg-background/60 border-border/60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Initial Status
            </label>
            <div className="flex gap-2">
              {(["in_progress", "closed", "failed"] as ActionStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-all",
                    status === s
                      ? STATUS_META[s].badge + " ring-1 ring-current"
                      : "border-border/60 text-muted-foreground hover:border-border",
                  )}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">{(mutation.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!title.trim() || mutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              {mutation.isPending ? "Creating…" : "Create Action"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// â”€â”€â”€ Action Detail Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ActionDetailSheet({
  action,
  open,
  onOpenChange,
}: {
  action: Action | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (status: ActionStatus) => patchAction(action!.id, { status }),
    onMutate: async (newStatus) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      const prev = qc.getQueryData<Action[]>(["actions"]);
      qc.setQueryData<Action[]>(["actions"], (old = []) =>
        old.map((a) => (a.id === action!.id ? { ...a, status: newStatus } : a)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["actions"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["actions"] }),
  });

  const addMutation = useMutation({
    mutationFn: (text: string) =>
      addComment(action!.id, text, user?.displayName ?? user?.email ?? "Admin"),
    onMutate: async (text: string) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      const prev = qc.getQueryData<Action[]>(["actions"]);
      const optimistic: ActionComment = {
        id: `optimistic-${Date.now()}`,
        text,
        author: user?.displayName ?? user?.email ?? "Admin",
        createdAt: new Date().toISOString(),
        type: "update",
      };
      qc.setQueryData<Action[]>(["actions"], (old = []) =>
        old.map((a) => (a.id === action!.id ? { ...a, comments: [...a.comments, optimistic] } : a)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["actions"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["actions"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(action!.id, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["actions"] }),
  });

  const destroyMutation = useMutation({
    mutationFn: () => deleteAction(action!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      setConfirmDelete(false);
      onOpenChange(false);
    },
  });

  const ai = useAiSuggestions(action?.id, action);

  if (!action) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-border bg-surface p-0 sm:max-w-[560px]"
        >
          <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
            <SheetHeader className="space-y-3 text-left">
              <div className="flex items-center gap-2">
                <StatusBadge status={action.status} />
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {fmtDate(action.createdAt)}
                </span>
              </div>
              <SheetTitle className="font-display text-xl leading-tight text-foreground">
                {action.title}
              </SheetTitle>
              {action.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {action.description}
                </p>
              )}
            </SheetHeader>
          </div>

          <div className="px-6 py-6 space-y-8">
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Filter className="size-3.5" /> Change Status
              </h3>
              <div className="flex gap-2">
                {(["in_progress", "closed", "failed"] as ActionStatus[]).map((s) => {
                  const active = action.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => !active && statusMutation.mutate(s)}
                      disabled={active || statusMutation.isPending}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all",
                        active
                          ? STATUS_META[s].badge + " ring-1 ring-current"
                          : "border-border/60 text-muted-foreground hover:border-border disabled:opacity-40",
                      )}
                    >
                      {STATUS_META[s].icon} {STATUS_META[s].label}
                    </button>
                  );
                })}
              </div>
            </section>

            <Separator className="bg-border" />

            <CommentThread
              action={action}
              onAddComment={(text) => addMutation.mutate(text)}
              onDeleteComment={(id) => deleteMutation.mutate(id)}
              isAddPending={addMutation.isPending}
              isDeletePending={deleteMutation.isPending}
              onGenerateAI={ai.generate}
              isGeneratingAI={ai.loading}
            />

            <Separator className="bg-border" />

            <section>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-2 size-4" /> Delete Action
              </Button>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={confirmDelete}
        onOpenChange={(v) => !destroyMutation.isPending && setConfirmDelete(v)}
      >
        <DialogContent className="sm:max-w-sm bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Delete action?
            </DialogTitle>
            <DialogDescription>
              This will permanently remove{" "}
              <strong className="text-foreground">"{action.title}"</strong> and all its comments.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={destroyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => destroyMutation.mutate()}
              disabled={destroyMutation.isPending}
            >
              {destroyMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RecStatusBadge({ status }: { status: string }) {
  const isOverdue = status === "Expired / overdue";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        isOverdue
          ? "border-red-500/40 bg-red-500/10 text-red-400"
          : "border-orange-400/40 bg-orange-500/10 text-orange-400",
      )}
    >
      <span className={cn("size-1.5 rounded-full", isOverdue ? "bg-red-500" : "bg-orange-500")} />
      {isOverdue ? "Overdue" : "Due Soon"}
    </span>
  );
}

// â”€â”€â”€ Comment Thread â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function useAiSuggestions(actionId: string | undefined, action?: Action | null) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedSteps = useMemo<string[]>(() => {
    if (!action) return [];
    const suggestions = action.comments.filter((c) => c.type === "ai_suggestion");
    if (suggestions.length === 0) return [];
    const latest = suggestions[suggestions.length - 1];
    try {
      const data = JSON.parse(latest.text);
      return Array.isArray(data.steps) ? data.steps : [];
    } catch {
      return [];
    }
  }, [action]);

  const [liveSteps, setLiveSteps] = useState<string[]>(savedSteps);

  useEffect(() => {
    setLiveSteps(savedSteps);
    setError(null);
  }, [actionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLiveSteps(savedSteps);
  }, [savedSteps]);

  async function generate() {
    if (!actionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await suggestNextSteps(actionId);
      const suggestions = result.comments.filter((c) => c.type === "ai_suggestion");
      const latest = suggestions[suggestions.length - 1];
      let newSteps: string[] = [];
      if (latest) {
        try {
          const data = JSON.parse(latest.text);
          newSteps = Array.isArray(data.steps) ? data.steps : [];
        } catch {
          /* ignore */
        }
      }
      setLiveSteps(newSteps);
      qc.setQueryData<Action[]>(["actions"], (old = []) =>
        old.map((a) => (a.id === result.id ? result : a)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { steps: liveSteps, loading, error, generate };
}

function AiSuggestions({
  steps,
  loading,
  error,
}: {
  steps: string[];
  loading: boolean;
  error: string | null;
}) {
  if (!loading && steps.length === 0 && !error) return null;
  return (
    <section className="space-y-2">
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {loading && steps.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 italic py-1">
          <span className="size-3 animate-spin rounded-full border border-primary border-t-transparent" />
          Generating AI steps…
        </div>
      )}
      {steps.length > 0 && (
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-black text-primary">
                {i + 1}
              </span>
              <span className="text-sm text-foreground leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CommentThread({
  action,
  onAddComment,
  onDeleteComment,
  isAddPending,
  isDeletePending,
  onGenerateAI,
  isGeneratingAI,
}: {
  action: Action | null;
  onAddComment: (text: string) => void;
  onDeleteComment: (id: string) => void;
  isAddPending: boolean;
  isDeletePending: boolean;
  onGenerateAI?: () => void;
  isGeneratingAI?: boolean;
}) {
  const [text, setText] = useState("");
  const comments = action?.comments ?? [];
  const userComments = comments.filter((c) => c.type !== "ai_suggestion");

  function send() {
    if (!text.trim()) return;
    onAddComment(text.trim());
    setText("");
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
          <MessageSquare className="size-3.5" /> Comments
          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold">
            {userComments.length}
          </span>
        </h3>
        {onGenerateAI && (
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerateAI}
            disabled={isGeneratingAI || userComments.length === 0}
            className="ml-auto h-7 gap-1.5 border-primary/30 text-primary hover:bg-primary/8 text-xs font-bold"
          >
            {isGeneratingAI ? (
              <>
                <span className="size-3 animate-spin rounded-full border border-primary border-t-transparent" />{" "}
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-3" /> AI Suggested Next Steps
              </>
            )}
          </Button>
        )}
      </div>
      {userComments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground/60">
          No comments yet. Add the first one below.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
          {comments.map((c) => {
            const isAI = c.author === "AI Assistant";
            let aiSteps: string[] | null = null;
            if (isAI) {
              try {
                const parsed = JSON.parse(c.text) as { steps?: string[] };
                if (Array.isArray(parsed.steps)) aiSteps = parsed.steps;
              } catch {
                /* fall through */
              }
            }

            return (
              <div
                key={c.id}
                className={cn(
                  "group relative rounded-xl border p-4",
                  isAI ? "border-primary/25 bg-primary/5" : "border-border/60 bg-background/40",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-[10px] font-bold",
                        isAI ? "bg-primary/20 text-primary" : "bg-primary/15 text-primary",
                      )}
                    >
                      {isAI ? <Sparkles className="size-3" /> : (c.author[0] ?? "A").toUpperCase()}
                    </div>
                    <span className="text-xs font-semibold text-foreground">{c.author}</span>
                    {isAI && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary tracking-wide">
                        AI
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {fmtDate(c.createdAt)}
                    </span>
                    <button
                      onClick={() => onDeleteComment(c.id)}
                      disabled={isDeletePending}
                      className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                {aiSteps ? (
                  <ol className="space-y-2 mt-1">
                    {aiSteps.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 rounded-lg border border-primary/15 bg-background/60 px-3 py-2"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-black text-primary mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-foreground/90 leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.text}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Add a comment… (Ctrl+Enter to send)"
          rows={3}
          className="resize-none bg-background/60 border-border/60 focus:border-primary/50 text-sm"
        />
        <div className="flex justify-end">
          <Button
            onClick={send}
            disabled={!text.trim() || isAddPending}
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
          >
            {isAddPending ? (
              "Sending…"
            ) : (
              <>
                <Send className="mr-2 size-3.5" />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

// â”€â”€â”€ Ticket Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TicketSheet({
  rec,
  linkedAction,
  open,
  onOpenChange,
}: {
  rec: Recommendation | null;
  linkedAction: Action | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOverdue = rec?.status === "Expired / overdue";
  const [pendingStatus, setPendingStatus] = useState<ActionStatus | null>(null);
  const ai = useAiSuggestions(linkedAction?.id, linkedAction);

  const getOrCreateActionId = async (): Promise<string> => {
    if (linkedAction) return linkedAction.id;
    const created = await createAction({
      title: rec!.equipment ?? rec!.customer ?? rec!.sourceFile,
      description: rec!.recommendation,
      status: "in_progress",
      linkedRecId: rec!.id,
    });
    qc.invalidateQueries({ queryKey: ["actions"] });
    return created.id;
  };

  const addMutation = useMutation({
    mutationFn: async (text: string) => {
      const id = await getOrCreateActionId();
      return addComment(id, text, user?.displayName ?? user?.email ?? "Admin");
    },
    onMutate: async (text: string) => {
      if (!linkedAction) return;
      await qc.cancelQueries({ queryKey: ["actions"] });
      const prev = qc.getQueryData<Action[]>(["actions"]);
      const optimistic: ActionComment = {
        id: `optimistic-${Date.now()}`,
        text,
        author: user?.displayName ?? user?.email ?? "Admin",
        createdAt: new Date().toISOString(),
        type: "update",
      };
      qc.setQueryData<Action[]>(["actions"], (old = []) =>
        old.map((a) =>
          a.id === linkedAction.id ? { ...a, comments: [...a.comments, optimistic] } : a,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["actions"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["actions"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(linkedAction!.id, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["actions"] }),
  });

  const statusMutation = useMutation({
    mutationFn: async (status: ActionStatus) => {
      const id = await getOrCreateActionId();
      return patchAction(id, { status });
    },
    onMutate: async (newStatus) => {
      setPendingStatus(newStatus);
      await qc.cancelQueries({ queryKey: ["actions"] });
      const prev = qc.getQueryData<Action[]>(["actions"]);
      if (linkedAction) {
        qc.setQueryData<Action[]>(["actions"], (old = []) =>
          old.map((a) => (a.id === linkedAction.id ? { ...a, status: newStatus } : a)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      setPendingStatus(null);
      if (ctx?.prev) qc.setQueryData(["actions"], ctx.prev);
    },
    onSettled: () => {
      setPendingStatus(null);
      qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });

  if (!rec) return null;
  const actionStatus: ActionStatus | null = linkedAction?.status ?? null;
  const effectiveStatus = pendingStatus ?? actionStatus;

  function Field({
    label,
    value,
    icon,
  }: {
    label: string;
    value?: string | null;
    icon?: React.ReactNode;
  }) {
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-0.5">
          {icon && <span className="text-muted-foreground/60">{icon}</span>}
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
        </div>
        <p
          className={cn(
            "text-sm font-mono",
            value ? "text-foreground" : "text-muted-foreground/40",
          )}
        >
          {value ?? "—"}
        </p>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-border bg-surface p-0 sm:max-w-[600px]"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
          <SheetHeader className="space-y-3 text-left">
            <div className="flex items-center gap-2 flex-wrap">
              <RecStatusBadge status={rec.status} />
              {linkedAction && <StatusBadge status={linkedAction.status} />}
              <span
                className={cn(
                  "ml-auto text-xs font-bold px-2 py-0.5 rounded",
                  rec.priority === "High"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {rec.priority}
              </span>
            </div>
            <SheetTitle className="font-display text-xl leading-tight text-foreground">
              {rec.equipment ?? rec.sourceFile}
            </SheetTitle>
            {rec.customer && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Building2 className="size-3.5 shrink-0" />
                {rec.customer}
              </p>
            )}
          </SheetHeader>
        </div>

        <div className="px-6 py-6 space-y-8">
          {/* Urgency banner */}
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4",
              isOverdue
                ? "border-red-500/30 bg-red-500/8 text-red-400"
                : "border-orange-400/30 bg-orange-500/8 text-orange-400",
            )}
          >
            {isOverdue ? (
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            ) : (
              <CalendarClock className="size-4 mt-0.5 shrink-0" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {isOverdue
                  ? `Overdue by ${Math.abs(rec.monthsToRecert ?? 0)} month${Math.abs(rec.monthsToRecert ?? 0) !== 1 ? "s" : ""}`
                  : rec.monthsToRecert != null
                    ? `Due in ${rec.monthsToRecert} month${rec.monthsToRecert !== 1 ? "s" : ""}`
                    : "Due soon"}
              </p>
              {rec.recertificationDue && (
                <p className="mt-0.5 text-xs opacity-80">
                  Recertification due: {rec.recertificationDue}
                </p>
              )}
            </div>
          </div>

          {/* Details */}
          <section>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
              <FileText className="size-3.5" /> Record Details
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field
                label="Customer"
                value={rec.customer}
                icon={<Building2 className="size-3" />}
              />
              <Field label="Equipment" value={rec.equipment} icon={<Wrench className="size-3" />} />
              <Field
                label="Sales Order"
                value={rec.salesOrder}
                icon={<Hash className="size-3" />}
              />
              <Field
                label="Purchase Order"
                value={rec.purchaseOrder}
                icon={<Hash className="size-3" />}
              />
              <Field label="Location" value={rec.location} />
              <Field
                label="Certificate Date"
                value={rec.certificateDate}
                icon={<CalendarClock className="size-3" />}
              />
            </div>
          </section>

          <Separator className="bg-border" />

          {/* Parts & Serials */}
          <section>
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <Package className="size-3.5" /> Parts &amp; Serials
            </h3>
            {(() => {
              const { groups, unattributedSerials } = groupSerialsByPart(rec);
              const totalParts = groups.length;
              const totalSerials = rec.serials.length;
              if (totalParts === 0 && totalSerials === 0) {
                return <span className="text-sm text-muted-foreground">—</span>;
              }
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <span>
                      {totalParts} part{totalParts !== 1 ? "s" : ""}
                    </span>
                    <span className="text-border">·</span>
                    <span>
                      {totalSerials} serial{totalSerials !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* One card per part: header (qty × number — description),
                      followed by the serials that belong to it. */}
                  <div className="space-y-2">
                    {groups.map((g) => (
                      <div
                        key={g.part.number}
                        className="rounded-lg border border-border bg-muted/30 p-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          {g.part.qty != null && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                              {g.part.qty}×
                            </span>
                          )}
                          <span className="font-mono text-sm font-semibold text-foreground">
                            {g.part.number}
                          </span>
                          {g.part.description && (
                            <span className="text-xs text-muted-foreground">
                              — {g.part.description}
                            </span>
                          )}
                        </div>
                        {g.serials.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {g.serials.map((s) => (
                              <span
                                key={s}
                                className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                <Hash className="mr-0.5 inline size-2.5" />
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {unattributedSerials.length > 0 && (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Other serials ({unattributedSerials.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {unattributedSerials.map((s) => (
                          <span
                            key={s}
                            className="rounded border border-border/60 bg-background px-2 py-1 font-mono text-xs text-muted-foreground"
                          >
                            <Hash className="mr-1 inline size-3" />
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>

          {/* AI Recommendation */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
              <Zap className="size-3.5" /> AI Recommendation
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed rounded-xl border border-border/60 bg-background/40 p-4">
              {rec.recommendation}
            </p>
          </section>

          <Separator className="bg-border" />

          {/* Ticket status */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
              <Filter className="size-3.5" /> Ticket Status
            </h3>
            <div className="flex gap-2">
              {(["in_progress", "closed", "failed"] as ActionStatus[]).map((s) => {
                const active = effectiveStatus === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => !active && statusMutation.mutate(s)}
                    disabled={statusMutation.isPending}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all",
                      active
                        ? STATUS_META[s].badge + " ring-1 ring-current"
                        : "border-border/60 text-muted-foreground hover:border-border disabled:opacity-40",
                    )}
                  >
                    {STATUS_META[s].icon} {STATUS_META[s].label}
                  </button>
                );
              })}
            </div>
          </section>

          <Separator className="bg-border" />

          <CommentThread
            action={linkedAction ?? null}
            onAddComment={(text) => addMutation.mutate(text)}
            onDeleteComment={(id) => deleteMutation.mutate(id)}
            isAddPending={addMutation.isPending}
            isDeletePending={deleteMutation.isPending}
            onGenerateAI={ai.generate}
            isGeneratingAI={ai.loading}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// â”€â”€â”€ Ticket Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TicketCard({
  rec,
  linkedAction,
  onClick,
}: {
  rec: Recommendation;
  linkedAction: Action | undefined;
  onClick: () => void;
}) {
  const isOverdue = rec.status === "Expired / overdue";
  const commentCount = linkedAction?.comments.filter((c) => c.type !== "ai_suggestion").length ?? 0;
  const actionStatus = linkedAction?.status;
  const tint =
    actionStatus === "closed"
      ? "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60 hover:shadow-emerald-500/5"
      : actionStatus === "failed"
        ? "border-red-500/40 bg-red-500/5 hover:border-red-500/60 hover:shadow-red-500/5"
        : actionStatus === "in_progress"
          ? "border-orange-400/40 bg-orange-400/5 hover:border-orange-400/60 hover:shadow-orange-400/5"
          : "border-border/60 bg-surface hover:border-primary/30 hover:shadow-primary/5";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border p-5 text-left transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/30",
        tint,
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-1 rounded-l-2xl",
          isOverdue ? "bg-red-500" : "bg-orange-500",
        )}
      />
      <div className="flex items-start justify-between gap-2 pl-3">
        <div className="flex items-center gap-2 flex-wrap">
          <RecStatusBadge status={rec.status} />
          {linkedAction && <StatusBadge status={linkedAction.status} />}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/60" />
      </div>
      <div className="pl-3">
        <p className="text-sm font-semibold text-foreground leading-snug line-clamp-1">
          {rec.equipment ?? rec.sourceFile}
        </p>
        {rec.customer && (
          <p className="mt-0.5 text-xs text-muted-foreground/70 flex items-center gap-1">
            <Building2 className="size-3 shrink-0" />
            <span className="truncate">{rec.customer}</span>
          </p>
        )}
      </div>
      <div className="pl-3 space-y-1">
        {rec.recertificationDue && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <CalendarClock
              className={cn("size-3 shrink-0", isOverdue ? "text-red-400" : "text-orange-400")}
            />
            <span
              className={cn(
                "font-mono font-semibold",
                isOverdue ? "text-red-400" : "text-orange-400",
              )}
            >
              {rec.recertificationDue}
            </span>
          </div>
        )}
        {rec.monthsToRecert != null && (
          <p
            className={cn(
              "text-[11px] font-semibold",
              isOverdue ? "text-red-400/80" : "text-orange-400/80",
            )}
          >
            {isOverdue
              ? `${Math.abs(rec.monthsToRecert)}mo overdue`
              : `${rec.monthsToRecert}mo remaining`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 pl-3 pt-1 border-t border-border/40">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <MessageSquare className="size-3" /> {commentCount}
        </div>
        <span className="size-1 rounded-full bg-border/60" />
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold",
            rec.priority === "High"
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {rec.priority}
        </span>
      </div>
    </button>
  );
}

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type TabKey = "tickets" | "actions";
type ActionStatusFilter = "all" | ActionStatus;

function ActionCenter() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Developer") {
        navigate({ to: "/developer" });
      } else if (user.role === "Uploader") {
        navigate({ to: "/upload" });
      }
    }
  }, [user, loading, navigate]);

  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [hideResolved, setHideResolved] = useState(true);
  const [hideFailed, setHideFailed] = useState(true);

  const { data: recsData } = useQuery({
    queryKey: ["recommendations"],
    queryFn: fetchRecommendations,
    refetchInterval: 60_000,
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["actions"],
    queryFn: fetchActions,
    refetchInterval: 30_000,
  });

  const recs = recsData?.recommendations ?? [];
  const overdueRecs = recs.filter((r) => r.status === "Expired / overdue");
  const dueSoonRecs = recs.filter((r) => r.status === "Due soon");
  const attentionRecs = [...overdueRecs, ...dueSoonRecs];

  function getLinkedAction(rec: Recommendation) {
    return actions.find((a) => a.linkedRecId === rec.id);
  }

  function openTicket(rec: Recommendation) {
    setSelectedRec(rec);
    setTicketOpen(true);
  }

  const liveLinkedAction = selectedRec ? getLinkedAction(selectedRec) : undefined;

  // KPI metrics
  const customersAffected = useMemo(
    () => new Set(attentionRecs.map((r) => r.customer).filter(Boolean)).size,
    [attentionRecs],
  );
  const highPriorityCount = attentionRecs.filter((r) => r.priority === "High").length;
  const allInProgress = actions.filter((a) => a.status === "in_progress").length;
  const allClosed = actions.filter((a) => a.status === "closed").length;

  // Client options for filter dropdown
  const clientOptions = useMemo(
    () => [...new Set(attentionRecs.map((r) => r.customer).filter(Boolean) as string[])].sort(),
    [attentionRecs],
  );

  // Filtered ticket lists
  const filteredOverdue = useMemo(
    () =>
      overdueRecs.filter((rec) => {
        if (hideResolved && actions.find((a) => a.linkedRecId === rec.id)?.status === "closed")
          return false;
        if (hideFailed && actions.find((a) => a.linkedRecId === rec.id)?.status === "failed")
          return false;
        if (selectedClients.length > 0 && !selectedClients.includes(rec.customer ?? ""))
          return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const hay = [
            rec.customer,
            rec.equipment,
            rec.salesOrder,
            rec.purchaseOrder,
            ...rec.serials,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [overdueRecs, hideResolved, hideFailed, selectedClients, searchQuery, actions],
  );

  const filteredDueSoon = useMemo(
    () =>
      dueSoonRecs.filter((rec) => {
        if (hideResolved && actions.find((a) => a.linkedRecId === rec.id)?.status === "closed")
          return false;
        if (hideFailed && actions.find((a) => a.linkedRecId === rec.id)?.status === "failed")
          return false;
        if (selectedClients.length > 0 && !selectedClients.includes(rec.customer ?? ""))
          return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const hay = [
            rec.customer,
            rec.equipment,
            rec.salesOrder,
            rec.purchaseOrder,
            ...rec.serials,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [dueSoonRecs, hideResolved, hideFailed, selectedClients, searchQuery, actions],
  );

  const resolvedHiddenCount = useMemo(
    () =>
      attentionRecs.filter((r) => actions.find((a) => a.linkedRecId === r.id)?.status === "closed")
        .length,
    [attentionRecs, actions],
  );

  const failedHiddenCount = useMemo(
    () =>
      attentionRecs.filter((r) => actions.find((a) => a.linkedRecId === r.id)?.status === "failed")
        .length,
    [attentionRecs, actions],
  );

  return (
    <div className="w-full">
      {/* Hero */}
      <section className="relative overflow-hidden py-14">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-[20%] left-[10%] size-[40%] rounded-full bg-primary/8 blur-[140px]" />
          <div className="absolute top-[30%] right-[5%] size-[25%] rounded-full bg-accent/8 blur-[100px]" />
          <div className="absolute bottom-0 left-1/2 h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        </div>
        <div className="relative mx-auto max-w-[1600px] px-6 flex flex-col gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-4 py-1.5 w-fit font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary shadow-sm shadow-primary/10">
            <Zap className="size-3" /> Overdue &amp; Upcoming Recertifications
          </div>
          <h1 className="font-display text-5xl font-black leading-tight tracking-tight text-accent md:text-6xl">
            Needs{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent italic">
              Attention
            </span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground/80">
            Overdue and upcoming recertification tickets. Search, filter by priority or customer —
            resolved tickets are hidden by default.
          </p>
        </div>
      </section>

      {/* KPI Metrics */}
      <div className="mx-auto max-w-[1600px] px-6 mb-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            icon={<AlertTriangle className="size-5" />}
            label="Overdue"
            value={overdueRecs.length}
            sub="Require immediate action"
            tone="danger"
          />
          <MetricCard
            icon={<CalendarClock className="size-5" />}
            label="Due Soon"
            value={dueSoonRecs.length}
            sub="Upcoming recertifications"
            tone="warning"
          />
          <MetricCard
            icon={<Clock3 className="size-5" />}
            label="Open Actions"
            value={allInProgress}
            sub="Work orders in progress"
            tone="primary"
          />
          <MetricCard
            icon={<CheckCircle2 className="size-5" />}
            label="Resolved"
            value={allClosed}
            sub="Actions closed out"
            tone="success"
          />
          <MetricCard
            icon={<Building2 className="size-5" />}
            label="Customers"
            value={customersAffected}
            sub="Requiring attention"
            tone="navy"
          />
          <MetricCard
            icon={<ShieldAlert className="size-5" />}
            label="High Priority"
            value={highPriorityCount}
            sub="Across all tickets"
            tone="danger"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="mx-auto max-w-[1600px] px-6 mb-8">
        <MonthlyTrendChart actions={actions} />
      </div>

      {/* Filter bar + Tickets */}
      <div className="mx-auto max-w-[1600px] px-6 pb-20">
        {/* Search & Filters */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer, equipment, order…"
              className="h-10 w-full rounded-xl border border-border/50 bg-secondary/40 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 focus:bg-secondary/60 transition-all"
            />
          </div>

          {clientOptions.length > 0 && (
            <select
              value={selectedClients[0] ?? ""}
              onChange={(e) => setSelectedClients(e.target.value ? [e.target.value] : [])}
              className="h-10 rounded-xl border border-border/50 bg-secondary/40 px-3 text-sm text-muted-foreground focus:outline-none focus:border-primary/40 transition-all"
            >
              <option value="">All customers</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setHideResolved((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold border transition-all",
              hideResolved
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-border/50 bg-secondary/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {hideResolved ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {hideResolved ? `Hide resolved (${resolvedHiddenCount})` : "Show resolved"}
          </button>
          <button
            onClick={() => setHideFailed((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold border transition-all",
              hideFailed
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-border/50 bg-secondary/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {hideFailed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {hideFailed ? `Hide failed (${failedHiddenCount})` : "Show failed"}
          </button>
        </div>

        <div className="space-y-10">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="size-4 text-red-400" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-red-400">
                Overdue — {filteredOverdue.length} ticket{filteredOverdue.length !== 1 ? "s" : ""}
              </h2>
            </div>
            {filteredOverdue.length === 0 ? (
              <div className="rounded-xl border border-dashed border-red-500/20 py-8 text-center text-sm text-muted-foreground/50">
                {overdueRecs.length === 0
                  ? "No overdue tickets. Great job!"
                  : "No tickets match the current filters."}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredOverdue.map((rec) => (
                  <TicketCard
                    key={rec.id}
                    rec={rec}
                    linkedAction={getLinkedAction(rec)}
                    onClick={() => openTicket(rec)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-4 flex items-center gap-3">
              <CalendarClock className="size-4 text-orange-400" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-orange-400">
                Due Soon — {filteredDueSoon.length} ticket{filteredDueSoon.length !== 1 ? "s" : ""}
              </h2>
            </div>
            {filteredDueSoon.length === 0 ? (
              <div className="rounded-xl border border-dashed border-orange-400/20 py-8 text-center text-sm text-muted-foreground/50">
                {dueSoonRecs.length === 0
                  ? "No upcoming tickets."
                  : "No tickets match the current filters."}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredDueSoon.map((rec) => (
                  <TicketCard
                    key={rec.id}
                    rec={rec}
                    linkedAction={getLinkedAction(rec)}
                    onClick={() => openTicket(rec)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <TicketSheet
        rec={selectedRec}
        linkedAction={liveLinkedAction}
        open={ticketOpen}
        onOpenChange={setTicketOpen}
      />
    </div>
  );
}
