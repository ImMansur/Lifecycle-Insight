import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recommendation } from "@/lib/wom-data";
import { groupSerialsByPart } from "@/lib/wom-data";
import {
  fetchRecommendations,
  ingestFiles,
  confirmIngestUpdates,
  deleteRecommendation,
  deleteMultipleRecommendations,
  fetchActions,
  exportToExcel,
} from "@/lib/api";
import type { Action, PendingDuplicate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusBadge, PriorityChip } from "@/components/wom/StatusBadge";
import { RecommendationDetail } from "@/components/wom/RecommendationDetail";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudUpload,
  FileSearch,
  FileText,
  Filter,
  Loader2,
  Package,
  Search,
  ShieldAlert,
  TrendingUp,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  LogOut,
  User,
  Settings,
  Bell,
  MessageSquare,
  MapPin,
  FileDown,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { NotificationBell } from "@/components/wom/NotificationBell";
import { useAuth } from "@/lib/auth-context";
import { LifecycleRulesTab } from "@/components/wom/LifecycleRulesTab";
import {
  FilterBar,
  MetricCard,
  ChartsSection,
  wildcardMatch,
  type TimeFilter,
  type PriorityFilter,
} from "@/components/wom/HomeTab";

type FilterKey = string;

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string | undefined) ?? "Home",
  }),
  component: Dashboard,
});

// ─── Upload Dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Duplicate-confirmation state — populated after a successful ingest
  // when the backend reports new records that collide with existing
  // (customer + sales-order + cert-date) keys.
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicate[]>([]);
  // existingId -> "replace" (overwrite) | "skip" (discard new record)
  const [decisions, setDecisions] = useState<Record<string, "replace" | "skip">>({});
  // Optional banner: how many records from the last batch were saved cleanly
  const [savedCount, setSavedCount] = useState<number>(0);

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (filesToUpload: File[]) => ingestFiles(filesToUpload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      setSavedCount(data.processed);
      if (data.errors.length > 0) {
        console.warn("Ingest warnings:", data.errors);
      }
      if (data.pendingDuplicates.length > 0) {
        // Switch the dialog into "resolve duplicates" mode — default every
        // collision to REPLACE (the admin's most common intent: re-uploaded
        // a corrected version of an existing CoC).
        setPendingDuplicates(data.pendingDuplicates);
        setDecisions(
          Object.fromEntries(data.pendingDuplicates.map((d) => [d.existingId, "replace" as const])),
        );
        setFiles([]); // file list no longer relevant
      } else {
        // Clean run — close the dialog
        setFiles([]);
        onOpenChange(false);
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmIngestUpdates,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      setPendingDuplicates([]);
      setDecisions({});
      setSavedCount(0);
      onOpenChange(false);
    },
  });

  const handleConfirmDuplicates = () => {
    const updates = pendingDuplicates
      .filter((d) => decisions[d.existingId] === "replace")
      .map((d) => ({
        existingId: d.existingId,
        newRecommendation: d.newRecommendation,
      }));
    if (updates.length === 0) {
      // Nothing to update — admin chose "Skip" on all of them
      setPendingDuplicates([]);
      setDecisions({});
      setSavedCount(0);
      onOpenChange(false);
      return;
    }
    confirmMutation.mutate(updates);
  };

  const addFiles = (incoming: FileList | File[]) => {
    const filtered = Array.from(incoming).filter((f) => /\.(pdf|doc|docx)$/i.test(f.name));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...filtered.filter((f) => !names.has(f.name))];
    });
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Block closing while a network call is in flight or duplicates are
        // pending — the admin needs to make a deliberate choice.
        if (!v && (mutation.isPending || confirmMutation.isPending)) return;
        if (!v) {
          setFiles([]);
          setPendingDuplicates([]);
          setDecisions({});
          setSavedCount(0);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg bg-surface border-border">
        {pendingDuplicates.length > 0 ? (
          // ─── Resolve duplicates view ──────────────────────────────────────
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-lg text-foreground flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" />
                Possible duplicates detected
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                {savedCount > 0 && (
                  <span className="block mb-1 text-emerald-600 font-medium">
                    {savedCount} new record{savedCount !== 1 ? "s" : ""} saved.
                  </span>
                )}
                {pendingDuplicates.length} uploaded file
                {pendingDuplicates.length !== 1 ? "s match" : " matches"} an existing record (same
                customer, sales order, and certificate date). Choose what to do with each one.
              </DialogDescription>
            </DialogHeader>

            <ul className="mt-2 max-h-[55vh] divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
              {pendingDuplicates.map((d) => {
                const decision = decisions[d.existingId] ?? "replace";
                return (
                  <li key={d.existingId + d.newRecommendation.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                          Existing record
                        </p>
                        <p
                          className="font-mono text-xs text-foreground truncate"
                          title={d.existingFile}
                        >
                          {d.existingFile}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {d.existingCustomer ?? "—"} · SO {d.existingSalesOrder ?? "—"} ·{" "}
                          {d.existingCertificateDate ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3 border-t border-border/30 pt-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                          New upload
                        </p>
                        <p
                          className="font-mono text-xs text-foreground truncate"
                          title={d.newRecommendation.sourceFile}
                        >
                          {d.newRecommendation.sourceFile}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setDecisions((p) => ({ ...p, [d.existingId]: "replace" }))}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                          decision === "replace"
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:border-accent/50"
                        }`}
                      >
                        Replace existing
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecisions((p) => ({ ...p, [d.existingId]: "skip" }))}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                          decision === "skip"
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:border-destructive/50"
                        }`}
                      >
                        Skip new upload
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {confirmMutation.isError && (
              <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                {(confirmMutation.error as Error).message}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Skip everything — close without applying any updates
                  setPendingDuplicates([]);
                  setDecisions({});
                  setSavedCount(0);
                  onOpenChange(false);
                }}
                disabled={confirmMutation.isPending}
              >
                Cancel all
              </Button>
              <Button
                size="sm"
                disabled={confirmMutation.isPending}
                onClick={handleConfirmDuplicates}
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold"
              >
                {confirmMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Applying…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 size-4" />
                    Apply decisions
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          // ─── Upload view ──────────────────────────────────────────────────
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-lg text-foreground">
                Ingest Documents
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                Upload PDF, DOC, or DOCX certificates of conformance. Each file is processed through
                Document Intelligence and the AI Extraction Engine.
              </DialogDescription>
            </DialogHeader>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-background/20 hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              <CloudUpload className="size-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  Drop files here or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, DOC, DOCX — up to 200 MB each
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <ul className="mt-3 max-h-48 divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                    <FileText className="size-4 shrink-0 text-primary/60" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(f.name);
                      }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Error banner */}
            {mutation.isError && (
              <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                {(mutation.error as Error).message}
              </div>
            )}

            {/* Partial errors from API */}
            {mutation.isSuccess && mutation.data.errors.length > 0 && (
              <div className="mt-2 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                {mutation.data.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  setFiles([]);
                }}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={files.length === 0 || mutation.isPending}
                onClick={() => mutation.mutate(files)}
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 size-4" />
                    Process {files.length} file{files.length !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// UserMenu component moved to __root.tsx layout wrapper

// ─── Confidence score ────────────────────────────────────────────────────────

function getConfidenceScore(r: {
  confidence: string;
  extractionStatus: string;
  customer: string | null;
  equipment: string | null;
  recertificationDue: string | null;
  salesOrder: string | null;
  purchaseOrder: string | null;
  certificateDate: string | null;
  location: string | null;
}): number {
  const keyFields = [
    r.customer,
    r.equipment,
    r.recertificationDue,
    r.salesOrder ?? r.purchaseOrder,
    r.certificateDate,
    r.location,
  ];
  const missingCount = keyFields.filter((f) => !f).length;
  const base = r.confidence === "High" ? 90 : 65;
  const ocrPenalty = r.extractionStatus !== "OK" ? 20 : 0;
  const fieldPenalty = missingCount * 2;
  return Math.max(5, Math.min(100, base - ocrPenalty - fieldPenalty));
}

function DebouncedInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [localVal, setLocalVal] = useState(value);
  const lastPropagated = useRef(value);

  // Sync with external value changes only
  useEffect(() => {
    if (value !== lastPropagated.current) {
      setLocalVal(value);
      lastPropagated.current = value;
    }
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localVal !== value) {
        lastPropagated.current = localVal;
        onChange(localVal);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [localVal, onChange, value]);

  return (
    <Input
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<"priority" | "customer" | "recertDue" | "status" | null>(
    null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── All filter state lives in the URL ─────────────────────────────────────
  const activeTab = search.tab;

  // Local React states instead of URL search params to ensure instant typing response
  const [query, setQuery] = useState("");
  const [recClients, setRecClients] = useState("");
  const [recLocations, setRecLocations] = useState("");
  const [recParts, setRecParts] = useState("");
  const [recDesc, setRecDesc] = useState("");
  const [recTimeFilter, setRecTimeFilter] = useState<TimeFilter>("all");
  const [recPriorityFilter, setRecPriorityFilter] = useState<PriorityFilter>("all");

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({
      to: "/dashboard",
      search: (prev: typeof search) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });

  const setActiveTab = (v: string) => setSearch({ tab: v });

  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: deleteRecommendation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
      setDeleteId(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: deleteMultipleRecommendations,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
    },
  });

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Uploader") {
        navigate({ to: "/upload" });
      }
    }
  }, [user, loading, navigate]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recommendations"],
    queryFn: fetchRecommendations,
    refetchInterval: 30_000,
  });

  const { data: actions = [] } = useQuery<Action[]>({
    queryKey: ["actions"],
    queryFn: fetchActions,
    refetchInterval: 30_000,
  });

  function getLinkedAction(recId: string) {
    return actions.find((a) => a.linkedRecId === recId);
  }

  const handleRefresh = () => {
    refetch();
    setLastRefreshed(new Date());
  };

  const recommendations = data?.recommendations ?? [];
  const summary = data?.summary ?? {
    inputFolder: "—",
    asOf: new Date().toISOString().slice(0, 10),
    filesProcessed: 0,
    ok: 0,
    highPriority: 0,
    needsOcr: 0,
  };

  // ── Filtered by FilterBar only → drives KPI cards + charts ──────────────
  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      // Advanced filters (FilterBar)
      if (recTimeFilter === "overdue") {
        if (r.monthsToRecert === null || r.monthsToRecert >= 0) return false;
      } else if (recTimeFilter === "3m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 3 || r.monthsToRecert < 0) return false;
      } else if (recTimeFilter === "6m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 6 || r.monthsToRecert < 0) return false;
      } else if (recTimeFilter === "12m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 12 || r.monthsToRecert < 0)
          return false;
      }
      if (recPriorityFilter !== "all" && r.priority !== recPriorityFilter) return false;
      
      // Free-text wildcard search criteria
      if (recClients && !wildcardMatch(r.customer, recClients)) return false;
      if (recLocations && !wildcardMatch(r.location, recLocations)) return false;
      if (recParts && !r.partNumbers.some((p) => wildcardMatch(p.number, recParts))) return false;
      if (recDesc && !(
        wildcardMatch(r.equipment, recDesc) || 
        r.partNumbers.some((p) => wildcardMatch(p.description, recDesc)) ||
        (r.lineItems ?? []).some((li) => wildcardMatch(li.description, recDesc))
      )) return false;

      return true;
    });
  }, [recommendations, recTimeFilter, recPriorityFilter, recClients, recLocations, recParts, recDesc]);

  // ── Table rows: filtered + text search → drives the records table only ───
  const tableRows = useMemo(() => {
    if (!query) return filtered;
    let q = query.trim().toLowerCase();
    if (
      (q.startsWith('"') && q.endsWith('"')) ||
      (q.startsWith("'") && q.endsWith("'"))
    ) {
      q = q.slice(1, -1).trim();
    }
    if (!q) return filtered;
    return filtered.filter((r) => {
      const hay = [
        r.customer,
        r.equipment,
        r.salesOrder,
        r.purchaseOrder,
        r.jobOrProject,
        r.location,
        r.sourceFile,
        ...r.partNumbers.map((p) => p.number),
        ...r.partNumbers.map((p) => p.description),
        ...(r.lineItems ?? []).map((li) => li.description),
        ...r.serials,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filtered, query]);

  // ── Sort + paginate ───────────────────────────────────────────────────────
  const PAGE_SIZE = 50;

  const sortedRows = useMemo(() => {
    if (!sortKey) return tableRows;
    return [...tableRows].sort((a, b) => {
      let av = "",
        bv = "";
      if (sortKey === "priority") {
        const order = { High: 0, "Manual review": 1, Low: 2 };
        const ai = order[a.priority as keyof typeof order] ?? 9;
        const bi = order[b.priority as keyof typeof order] ?? 9;
        return sortDir === "asc" ? ai - bi : bi - ai;
      }
      if (sortKey === "customer") {
        av = a.customer ?? "";
        bv = b.customer ?? "";
      } else if (sortKey === "recertDue") {
        av = a.recertificationDue ?? "9999-12-31";
        bv = b.recertificationDue ?? "9999-12-31";
      } else if (sortKey === "status") {
        av = a.status;
        bv = b.status;
      }
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [tableRows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sortedRows, page],
  );

  // Reset to page 0 whenever filters or search change
  useEffect(() => {
    setPage(0);
  }, [
    query,
    recTimeFilter,
    recPriorityFilter,
    recClients,
    recLocations,
    recParts,
    recDesc,
  ]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ChevronDown className="size-3 opacity-20" />;
    return sortDir === "asc" ? (
      <ChevronUp className="size-3 text-primary" />
    ) : (
      <ChevronDown className="size-3 text-primary" />
    );
  }

  function ExportButton({ ids }: { ids: string[] }) {
    const [loading, setLoading] = useState(false);
    async function handleExport() {
      if (!ids.length) return;
      setLoading(true);
      try {
        await exportToExcel(ids);
      } catch (err) {
        console.error("Export failed", err);
      } finally {
        setLoading(false);
      }
    }
    return (
      <button
        onClick={handleExport}
        disabled={loading || !ids.length}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-border/40 bg-secondary/30 px-4 text-sm font-semibold text-foreground hover:bg-slate-100 hover:border-border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        Export Excel{" "}
        {ids.length > 0 && <span className="text-muted-foreground">({ids.length})</span>}
      </button>
    );
  }

  // ── KPI metrics (from filtered results) ───────────────────────────────────
  const recMetrics = useMemo(() => {
    const total = filtered.length;
    const high = filtered.filter((r) => r.priority === "High").length;
    const overdue = filtered.filter((r) => r.status === "Expired / overdue").length;
    const dueSoon = filtered.filter(
      (r) => r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 6,
    ).length;
    const customers = new Set(filtered.map((r) => r.customer).filter(Boolean)).size;
    const equipment = new Set(filtered.map((r) => r.equipment).filter(Boolean)).size;
    const parts = filtered.reduce((a, r) => a + r.partNumbers.length, 0);
    const highConf = filtered.filter((r) => r.confidence === "High").length;
    const extractionRate = total > 0 ? Math.round((highConf / total) * 100) : 0;
    return { total, high, overdue, dueSoon, customers, equipment, parts, extractionRate };
  }, [filtered]);

  const openDetail = (r: Recommendation) => {
    setSelected(r);
    setOpen(true);
  };

  if (!user && !loading) return null;

  return (
    <div className="w-full">
      {activeTab === "Home" && (
        <>
          {/* ── Redesigned Compact Header Area ─────────────────────────── */}
          <section className="relative py-8 md:py-12 bg-gradient-to-b from-primary/5 to-transparent border-b border-border/30">
            <div className="mx-auto w-full max-w-[1600px] px-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
                <div className="space-y-3 flex-1">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
                    <span className="size-1.5 rounded-full bg-primary" />
                    Lifecycle Intelligence Engine
                  </div>
                  <h1 className="font-display text-4xl font-black tracking-tight text-[#0D1117] sm:text-5xl">
                    Proactive Lifecycle{" "}
                    <span className="text-primary italic font-semibold">Recommendations</span>
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80 font-medium">
                    Certificates of conformance parsed, structured, and matched against lifecycle
                    rules. Discover service opportunities, generate quotes, or queue customer
                    outreach.
                  </p>
                </div>

                {/* System Status Panel */}
                <div className="bg-surface/60 backdrop-blur-md border border-border/40 p-5 rounded-2xl md:min-w-[320px] flex items-center gap-4 hover:shadow-lg transition-all hover:bg-surface/85 group">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105 shrink-0">
                    <Zap className="size-6 animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">
                      System Status
                    </div>
                    <div className="text-sm font-bold text-foreground">Active & Operating</div>
                    <div className="text-[10px] text-muted-foreground/80 font-mono">
                      Synced As Of: {summary.asOf || "Today"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Sticky filter bar ──────────────────────────────────────── */}
          <div className="mx-auto w-full max-w-[1600px] px-8 pt-8 relative z-20">
            <FilterBar
              timeFilter={recTimeFilter}
              setTimeFilter={setRecTimeFilter}
              priorityFilter={recPriorityFilter}
              setPriorityFilter={setRecPriorityFilter}
              clientSearch={recClients}
              setClientSearch={setRecClients}
              locationSearch={recLocations}
              setLocationSearch={setRecLocations}
              partSearch={recParts}
              setPartSearch={setRecParts}
              descSearch={recDesc}
              setDescSearch={setRecDesc}
              count={filtered.length}
              total={recommendations.length}
            />
          </div>

          {/* ── Content Section (Solid White) ────────────────────────── */}
          <div className="relative bg-white pb-24 shadow-[0_-40px_80px_rgba(0,0,0,0.02)] pt-10">
            {/* KPI cards */}
            <div className="mx-auto w-full max-w-[1600px] px-8">
              <div className="flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">
                  Live Intelligence
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  icon={<FileText className="size-5" />}
                  label="Total Records"
                  value={isLoading ? "—" : recMetrics.total}
                  sub={`${recommendations.length} total ingested`}
                  tone="default"
                />
                <MetricCard
                  icon={<ShieldAlert className="size-5" />}
                  label="High Priority"
                  value={isLoading ? "—" : recMetrics.high}
                  sub={
                    recMetrics.total > 0
                      ? `${Math.round((recMetrics.high / recMetrics.total) * 100)}% of filtered`
                      : "No records"
                  }
                  tone="danger"
                  trend={recMetrics.high > 0 ? "up" : "neutral"}
                />
                <MetricCard
                  icon={<AlertTriangle className="size-5" />}
                  label="Overdue"
                  value={isLoading ? "—" : recMetrics.overdue}
                  sub="Recertification expired"
                  tone="danger"
                  trend={recMetrics.overdue > 0 ? "up" : "neutral"}
                />
                <MetricCard
                  icon={<Clock className="size-5" />}
                  label="Due ≤6 Months"
                  value={isLoading ? "—" : recMetrics.dueSoon}
                  sub="Upcoming recertification"
                  tone="warning"
                  trend={recMetrics.dueSoon > 0 ? "up" : "neutral"}
                />
                <MetricCard
                  icon={<Users className="size-5" />}
                  label="Active Customers"
                  value={isLoading ? "—" : recMetrics.customers}
                  sub="Unique customers on file"
                  tone="default"
                />
                <MetricCard
                  icon={<Wrench className="size-5" />}
                  label="Equipment Types"
                  value={isLoading ? "—" : recMetrics.equipment}
                  sub="Distinct equipment entries"
                  tone="default"
                />
                <MetricCard
                  icon={<Package className="size-5" />}
                  label="Part Numbers"
                  value={isLoading ? "—" : recMetrics.parts}
                  sub="Across all certificates"
                  tone="default"
                />
                <MetricCard
                  icon={<Zap className="size-5" />}
                  label="Extraction Accuracy"
                  value={isLoading ? "—" : `${recMetrics.extractionRate}%`}
                  sub={`${filtered.filter((r) => r.confidence === "High").length} high-confidence records`}
                  tone="success"
                  trend={recMetrics.extractionRate >= 80 ? "up" : "neutral"}
                />
              </div>
            </div>

            {/* ── Charts ─────────────────────────────────────────────────── */}
            <div className="mx-auto w-full max-w-[1600px] px-8 pt-20">
              <div className="mb-10 flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">
                  Analytics
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <ChartsSection filtered={filtered} />
            </div>

            {/* ── Records toolbar + table ─────────────────────────────────── */}
            <div className="mx-auto w-full max-w-[1600px] px-8 pt-20">
              {/* Divider + label */}
              <div className="mb-10 flex items-center gap-6">
                <div className="h-px flex-1 bg-border/40" />
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">
                  Records
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>

              {/* Toolbar */}
              <div className="mb-6 flex flex-wrap items-center gap-4">
                {/* Search */}
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                  <DebouncedInput
                    value={query}
                    onChange={setQuery}
                    placeholder="Search customer, SO, part…"
                    className="h-11 border-border/40 bg-secondary/30 pl-11 text-sm placeholder:text-muted-foreground/40 focus:bg-background transition-all rounded-xl"
                  />
                </div>

                {/* Record count badge + Export + Bulk Delete */}
                <div className="ml-auto flex items-center gap-3">
                  <div className="hidden rounded-xl border border-border/40 bg-secondary/20 px-4 py-2 font-display text-sm text-muted-foreground sm:flex items-center gap-2">
                    <span className="font-bold text-foreground">{tableRows.length}</span>
                    <span className="opacity-40">/</span>
                    <span>{recommendations.length} records</span>
                  </div>
                  {selectedIds.size > 0 && (
                    <>
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-border/40 bg-secondary/30 px-4 text-sm font-semibold text-muted-foreground hover:bg-slate-100 hover:text-foreground hover:border-border transition-all"
                      >
                        <X className="size-4" />
                        Clear selection
                      </button>
                      <button
                        onClick={() => setBulkDeleteOpen(true)}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 text-sm font-semibold text-destructive hover:bg-destructive/20 hover:border-destructive/60 transition-all"
                      >
                        <Trash2 className="size-4" />
                        Delete {selectedIds.size} selected
                      </button>
                    </>
                  )}
                  <ExportButton
                    ids={selectedIds.size > 0 ? [...selectedIds] : sortedRows.map((r) => r.id)}
                  />
                </div>
              </div>

              {/* Table container */}
              <div className="overflow-hidden rounded-3xl border border-border/40 bg-white shadow-2xl shadow-black/[0.02]">
                {/* Column headers */}
                <div className="grid grid-cols-[40px_8px_100px_1.5fr_1.4fr_1fr_1fr_130px_160px_48px] items-center gap-4 border-b border-border/30 bg-secondary/30 px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={
                        pagedRows.length > 0 && pagedRows.every((r) => selectedIds.has(r.id))
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedIds(
                            (prev) => new Set([...prev, ...pagedRows.map((r) => r.id)]),
                          );
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            pagedRows.forEach((r) => next.delete(r.id));
                            return next;
                          });
                        }
                      }}
                      aria-label="Select all on page"
                    />
                  </div>
                  <div /> {/* accent-bar spacer */}
                  <button
                    onClick={() => toggleSort("priority")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Priority <SortIcon col="priority" />
                  </button>
                  <button
                    onClick={() => toggleSort("customer")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Customer <SortIcon col="customer" />
                  </button>
                  <div>Equipment</div>
                  <div>SO / PO</div>
                  <button
                    onClick={() => toggleSort("recertDue")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Recert. Due <SortIcon col="recertDue" />
                  </button>
                  <button
                    onClick={() => toggleSort("status")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Status <SortIcon col="status" />
                  </button>
                  <div>Client Updates</div>
                  <div />
                </div>

                {/* Loading */}
                {isLoading && (
                  <div className="flex flex-col items-center justify-center gap-4 py-28">
                    <div className="relative size-12">
                      <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                      <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">Loading records…</p>
                  </div>
                )}

                {/* Error */}
                {isError && (
                  <div className="flex flex-col items-center justify-center gap-5 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-destructive/8 ring-1 ring-destructive/20">
                      <AlertTriangle className="size-7 text-destructive/70" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Could not reach the backend</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Run{" "}
                        <code className="rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-xs">
                          uvicorn main:app --reload
                        </code>
                      </p>
                      <p className="mt-2 font-mono text-xs text-destructive/60">
                        {(error as Error).message}
                      </p>
                    </div>
                  </div>
                )}

                {/* Empty — no documents */}
                {!isLoading && !isError && recommendations.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-5 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40">
                      <FileSearch className="size-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">No documents ingested yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Upload PDF, DOC, or DOCX certificates of conformance to get started.
                      </p>
                    </div>
                    {user?.role !== "Analysis" && (
                      <Button
                        size="sm"
                        onClick={() => navigate({ to: "/upload" })}
                        className="mt-1 bg-accent text-accent-foreground font-bold hover:bg-accent/90"
                      >
                        <Upload className="mr-2 size-4" />
                        Upload documents
                      </Button>
                    )}
                  </div>
                )}

                {/* Empty — no filter match */}
                {!isLoading && !isError && recommendations.length > 0 && tableRows.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-4 py-28 text-center">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40">
                      <FileSearch className="size-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">No records match your filters</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Try adjusting or clearing filters above.
                      </p>
                    </div>
                  </div>
                )}

                {/* Rows */}
                <div className="divide-y divide-border/25">
                  {pagedRows.map((r) => {
                    const overdue = r.status === "Expired / overdue";
                    const dueSoon =
                      r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 3;
                    const ocr = r.extractionStatus !== "OK";
                    // Row needs urgent human review: extraction failed AND admin hasn't reviewed yet
                    const needsReviewAsap =
                      !r.humanReviewed && (ocr || !r.customer || r.priority === "Manual review");
                    const accentColor = needsReviewAsap
                      ? "bg-amber-500"
                      : r.priority === "High"
                        ? "bg-destructive"
                        : r.priority === "Low"
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/30";
                    return (
                      <div
                        key={r.id}
                        onClick={() => openDetail(r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && openDetail(r)}
                        className={`group grid w-full grid-cols-[40px_8px_100px_1.5fr_1.4fr_1fr_1fr_130px_160px_48px] items-start gap-4 px-6 py-5 text-left transition-all duration-200 hover:bg-secondary/20 cursor-pointer ${selectedIds.has(r.id) ? "bg-primary/5" : ""} ${needsReviewAsap ? "bg-amber-50/60 hover:bg-amber-50/80 ring-1 ring-inset ring-amber-400/30" : ""}`}
                      >
                        {/* Checkbox */}
                        <div
                          className="flex items-center justify-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.has(r.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              });
                            }}
                            aria-label={`Select record ${r.id}`}
                          />
                        </div>
                        {/* Priority accent bar */}
                        <div
                          className={`h-10 w-1.5 rounded-full ${accentColor} opacity-60 transition-all group-hover:opacity-100 group-hover:scale-y-110`}
                        />

                        {/* Priority chip */}
                        <div>
                          {r.humanReviewed && r.priority === "Manual review" ? (
                            <span className="font-mono text-xs text-muted-foreground/40">—</span>
                          ) : (
                            <PriorityChip priority={r.priority} />
                          )}
                        </div>

                        {/* Customer */}
                        <div className="min-w-0">
                          {needsReviewAsap && !r.customer ? (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                                <span className="text-sm font-bold text-amber-700 truncate">
                                  Human review needed ASAP
                                </span>
                              </div>
                              <div className="font-mono text-[10px] font-semibold text-amber-600/70 uppercase tracking-wide truncate pl-5">
                                {r.sourceFile}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="truncate text-sm font-bold text-[#0D1117] transition-colors group-hover:text-primary">
                                {r.customer ?? (
                                  <span className="italic font-normal text-muted-foreground">
                                    Pending OCR
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide flex items-center gap-1.5">
                                {r.location && <MapPin className="size-3" />}
                                {r.location ? r.location : (r.jobOrProject ?? r.sourceFile)}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Equipment + parts */}
                        {(() => {
                          const { groups, unattributedSerials } = groupSerialsByPart(r);
                          const shownGroups = groups.slice(0, 2);
                          const hiddenCount = groups.length - shownGroups.length;
                          const totalSerials = r.serials.length;

                          return (
                            <div className="min-w-0 space-y-1">
                              {/* 1. Equipment name — highlighted. When missing, promote first part number as title */}
                              <div
                                className="truncate text-sm font-semibold text-foreground"
                                title={r.equipment ?? groups[0]?.part.number ?? undefined}
                              >
                                {r.equipment ??
                                  (groups.length > 0 ? (
                                    <span className="font-mono">
                                      {groups[0].part.number}
                                      {groups.length > 1 && (
                                        <span className="font-sans text-muted-foreground/70">
                                          , ...
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-normal text-muted-foreground/50">
                                      —
                                    </span>
                                  ))}
                              </div>

                              {/* 2. Qty × Part No rows */}
                              {groups.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  {shownGroups.map((g) => (
                                    <span
                                      key={g.part.number}
                                      className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-secondary/40 px-1.5 py-px font-mono text-[9px] text-foreground"
                                    >
                                      {g.part.qty != null && (
                                        <span className="font-bold text-primary">
                                          {g.part.qty}×
                                        </span>
                                      )}
                                      {g.part.number}
                                      {g.serials.length > 0 && (
                                        <span className="ml-0.5 text-muted-foreground/60">
                                          #{g.serials[0]}
                                          {g.serials.length > 1 ? ` +${g.serials.length - 1}` : ""}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                  {hiddenCount > 0 && (
                                    <HoverCard openDelay={120} closeDelay={80}>
                                      <HoverCardTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={(e) => e.stopPropagation()}
                                          className="rounded-md border border-dashed border-border/60 bg-secondary/30 px-1.5 py-px font-mono text-[9px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
                                        >
                                          +{hiddenCount} more
                                        </button>
                                      </HoverCardTrigger>
                                      <HoverCardContent
                                        side="right"
                                        align="start"
                                        className="w-80 p-3"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                          <span>{r.equipment ?? "Parts & Serials"}</span>
                                          <span>
                                            {groups.length} parts · {totalSerials} serials
                                          </span>
                                        </div>
                                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                                          {groups.map((g) => (
                                            <div
                                              key={g.part.number}
                                              className="rounded border border-border/60 bg-muted/30 p-2"
                                            >
                                              {/* Qty × Part No — Description */}
                                              <div className="flex flex-wrap items-baseline gap-x-1.5">
                                                {g.part.qty != null && (
                                                  <span className="rounded bg-primary/15 px-1 py-0.5 font-mono text-[9px] font-bold text-primary">
                                                    {g.part.qty}×
                                                  </span>
                                                )}
                                                <span className="font-mono text-xs font-semibold text-foreground">
                                                  {g.part.number}
                                                </span>
                                                {g.part.description && (
                                                  <span className="text-[10px] text-muted-foreground">
                                                    — {g.part.description}
                                                  </span>
                                                )}
                                              </div>
                                              {/* Serials */}
                                              {g.serials.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-0.5">
                                                  {g.serials.map((s) => (
                                                    <span
                                                      key={s}
                                                      className="rounded border border-border/40 bg-background px-1 py-px font-mono text-[9px] text-muted-foreground"
                                                    >
                                                      {s}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                          {unattributedSerials.length > 0 && (
                                            <div className="rounded border border-dashed border-border/50 bg-muted/20 p-2">
                                              <div className="mb-1 text-[9px] font-semibold uppercase text-muted-foreground">
                                                Other serials
                                              </div>
                                              <div className="flex flex-wrap gap-0.5">
                                                {unattributedSerials.map((s) => (
                                                  <span
                                                    key={s}
                                                    className="rounded border border-border/40 bg-background px-1 py-px font-mono text-[9px] text-muted-foreground"
                                                  >
                                                    {s}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* SO / PO */}
                        <div className="font-mono text-xs">
                          <div className="font-medium text-foreground">{r.salesOrder ?? "—"}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                            {r.purchaseOrder ?? "—"}
                          </div>
                        </div>

                        {/* Recert date */}
                        <div className="font-mono text-xs">
                          <div
                            className={
                              overdue
                                ? "font-bold text-destructive"
                                : dueSoon
                                  ? "font-bold text-warning"
                                  : "font-medium text-foreground"
                            }
                          >
                            {r.recertificationDue ?? "—"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                            {r.monthsToRecert !== null
                              ? r.monthsToRecert < 0
                                ? `${Math.abs(r.monthsToRecert)} mo overdue`
                                : `in ${r.monthsToRecert} mo`
                              : "—"}
                          </div>
                        </div>

                        {/* Status */}
                        <div className="flex flex-col gap-1">
                          {(() => {
                            let displayStatus = r.status;
                            if (r.humanReviewed && r.status === "Manual review") {
                              if (r.monthsToRecert !== null) {
                                // Recompute from stored monthsToRecert
                                if (r.monthsToRecert < 0) displayStatus = "Expired / overdue";
                                else if (r.monthsToRecert <= 12)
                                  displayStatus = "Due within 12 months";
                                else if (r.monthsToRecert <= 24)
                                  displayStatus = "Mid-cycle service opportunity";
                                else displayStatus = "Within lifecycle";
                              } else {
                                // No date — show null
                                return (
                                  <span className="font-mono text-xs text-muted-foreground/40">
                                    —
                                  </span>
                                );
                              }
                            }
                            return <StatusBadge status={displayStatus} />;
                          })()}
                          {r.humanReviewed ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="size-1.5 rounded-full bg-sky-500" />
                              <span className="font-mono text-[9px] font-bold text-sky-600 uppercase tracking-wide">
                                Reviewed by human
                              </span>
                            </div>
                          ) : (
                            (() => {
                              const score = getConfidenceScore(r);
                              const color =
                                score >= 80
                                  ? "text-emerald-500"
                                  : score >= 60
                                    ? "text-orange-400"
                                    : "text-red-400";
                              const bar =
                                score >= 80
                                  ? "bg-emerald-500"
                                  : score >= 60
                                    ? "bg-orange-400"
                                    : "bg-red-400";
                              const label = ocr ? " · OCR" : ` · ${r.confidence}`;
                              return (
                                <div
                                  className="flex items-center gap-1.5 mt-0.5"
                                  title={`Confidence: ${score}% — ${r.confidence}${ocr ? " (OCR document)" : ""}`}
                                >
                                  <span className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wide">
                                    Conf.
                                  </span>
                                  <div className="h-1 w-10 rounded-full bg-border/40 overflow-hidden">
                                    <div
                                      className={cn("h-full rounded-full", bar)}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                  <span className={cn("font-mono text-[9px] font-bold", color)}>
                                    {score}%{label}
                                  </span>
                                </div>
                              );
                            })()
                          )}
                        </div>

                        {/* Updates */}
                        {(() => {
                          const linked = getLinkedAction(r.id);
                          if (!linked)
                            return (
                              <div className="text-[10px] text-muted-foreground/30 italic">—</div>
                            );
                          const meta: Record<
                            string,
                            { label: string; dot: string; badge: string }
                          > = {
                            in_progress: {
                              label: "In Progress",
                              dot: "bg-orange-500",
                              badge: "text-orange-600 bg-orange-500/10 border-orange-500/25",
                            },
                            closed: {
                              label: "Closed",
                              dot: "bg-emerald-500",
                              badge: "text-emerald-600 bg-emerald-500/10 border-emerald-500/25",
                            },
                            failed: {
                              label: "Failed",
                              dot: "bg-red-500",
                              badge: "text-red-600 bg-red-500/10 border-red-500/25",
                            },
                          };
                          const m = meta[linked.status];
                          return (
                            <div className="flex flex-col gap-1.5">
                              {m && (
                                <span
                                  className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] font-bold ${m.badge}`}
                                >
                                  <span className={`size-1.5 rounded-full ${m.dot}`} />
                                  {m.label}
                                </span>
                              )}
                              {(() => {
                                const n = linked.comments.filter(
                                  (c) => c.type !== "ai_suggestion",
                                ).length;
                                return n > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                    <MessageSquare className="size-3" />
                                    {n} comment{n !== 1 ? "s" : ""}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                          );
                        })()}

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteId(r.id);
                            }}
                            className="rounded-lg p-1.5 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                          <ChevronRight className="size-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/50" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer / Pagination */}
              {!isLoading && !isError && (
                <div className="mt-8 flex flex-col gap-4 border-t border-border/25 pt-6 pb-12">
                  {/* Record count + rule info */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        Showing{" "}
                        <span className="font-bold text-foreground">
                          {page * PAGE_SIZE + 1}–
                          {Math.min((page + 1) * PAGE_SIZE, sortedRows.length)}
                        </span>{" "}
                        of <span className="font-bold text-foreground">{sortedRows.length}</span>
                        {sortedRows.length !== recommendations.length && (
                          <span className="text-muted-foreground/50">
                            {" "}
                            (filtered from {recommendations.length})
                          </span>
                        )}
                      </span>
                      <span className="size-1 rounded-full bg-border/60" />
                      <span>
                        Rule:{" "}
                        <span className="font-mono font-bold text-primary">
                          60-month recertification
                        </span>
                      </span>
                      <span className="size-1 rounded-full bg-border/60" />
                      <span className="font-mono text-[10px] opacity-60">as of {summary.asOf}</span>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-40">
                      WOM Lifecycle · v1.0
                    </div>
                  </div>

                  {/* Page controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setPage(0)}
                        disabled={page === 0}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="First page"
                      >
                        <ChevronsLeft className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous page"
                      >
                        <ChevronDown className="size-3.5 rotate-90" />
                      </button>

                      {/* Page number pills */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i)
                          .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
                          .reduce<(number | "…")[]>((acc, i, idx, arr) => {
                            if (idx > 0 && (i as number) - (arr[idx - 1] as number) > 1)
                              acc.push("…");
                            acc.push(i);
                            return acc;
                          }, [])
                          .map((item, idx) =>
                            item === "…" ? (
                              <span
                                key={`ellipsis-${idx}`}
                                className="px-1 text-xs text-muted-foreground/40"
                              >
                                …
                              </span>
                            ) : (
                              <button
                                key={item}
                                onClick={() => setPage(item as number)}
                                className={`flex size-8 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                                  page === item
                                    ? "bg-primary text-white shadow-md shadow-primary/20"
                                    : "border border-border/40 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                }`}
                              >
                                {(item as number) + 1}
                              </button>
                            ),
                          )}
                      </div>

                      <button
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page === totalPages - 1}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Next page"
                      >
                        <ChevronDown className="size-3.5 -rotate-90" />
                      </button>
                      <button
                        onClick={() => setPage(totalPages - 1)}
                        disabled={page === totalPages - 1}
                        className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Last page"
                      >
                        <ChevronsRight className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {activeTab === "Lifecycle Rules" && <LifecycleRulesTab />}

      <RecommendationDetail
        rec={selected}
        open={open}
        onOpenChange={setOpen}
        linkedAction={selected ? getLinkedAction(selected.id) : null}
      />

      {/* Single delete confirmation */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(v) => {
          if (!v && !deleteMutation.isPending) setDeleteId(null);
        }}
      >
        <DialogContent className="sm:max-w-sm bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Delete record?
            </DialogTitle>
            <DialogDescription>
              This will permanently remove this recommendation{" "}
              <strong>and any linked action</strong> from the database. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteId(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(v) => {
          if (!v && !bulkDeleteMutation.isPending) setBulkDeleteOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-sm bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Delete {selectedIds.size} record
              {selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This will permanently remove{" "}
              <strong>
                {selectedIds.size} recommendation{selectedIds.size !== 1 ? "s" : ""}
              </strong>{" "}
              and all their linked actions from the database. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {bulkDeleteMutation.isError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {(bulkDeleteMutation.error as Error).message}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                `Delete ${selectedIds.size}`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "primary" | "success" | "warning";
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-success"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/30 p-6 transition-all hover:bg-background/50 hover:border-amber/30 hover:shadow-2xl hover:shadow-amber/5 backdrop-blur-md">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
          {label}
        </div>
        <div
          className={`size-8 rounded-lg bg-foreground/[0.03] grid place-items-center ${toneCls}`}
        >
          {icon}
        </div>
      </div>
      <div className={`mt-4 font-display text-4xl font-bold tracking-tight ${toneCls}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-xs font-medium text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
