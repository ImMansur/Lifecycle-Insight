import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recommendation } from "@/lib/wom-data";
import { groupSerialsByPart, getEquipmentNames } from "@/lib/wom-data";
import {
  fetchRecommendations,
  deleteRecommendation,
  deleteMultipleRecommendations,
  fetchActions,
  exportToExcel,
} from "@/lib/api";
import type { Action } from "@/lib/api";
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
  FileSearch,
  FileText,
  Loader2,
  Package,
  ShieldAlert,
  Users,
  Wrench,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  MapPin,
  FileDown,
  MessageSquare,
  Upload,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/lib/auth-context";
import {
  FilterBar,
  wildcardMatch,
  type TimeFilter,
  type PriorityFilter,
} from "@/components/wom/HomeTab";

type FilterKey = string;

export const Route = createFileRoute("/records")({
  component: RecordsPage,
});

// ─── Confidence score ────────────────────────────────────────────────────────

function getConfidenceScore(r: {
  confidence: string;
  extractionStatus: string;
  customer: string | null;
  equipment: string | null;
  partNumbers?: { description: string | null }[];
  recertificationDue: string | null;
  salesOrder: string | null;
  purchaseOrder: string | null;
  certificateDate: string | null;
  location: string | null;
}): number {
  const hasEquipment = r.equipment || (r.partNumbers && r.partNumbers.some((p) => p.description?.trim()));
  const keyFields = [
    r.customer,
    hasEquipment ? "yes" : null,
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

// ─── Records Page Component ───────────────────────────────────────────────────

function RecordsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<"priority" | "customer" | "recertDue" | "status" | null>(
    null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Local React states for filters
  const [recClients, setRecClients] = useState("");
  const [recLocations, setRecLocations] = useState("");
  const [recParts, setRecParts] = useState("");
  const [recDesc, setRecDesc] = useState("");
  const [recTimeFilter, setRecTimeFilter] = useState<TimeFilter>("all");
  const [recPriorityFilter, setRecPriorityFilter] = useState<PriorityFilter>("all");

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
      } else if (user.role === "Developer") {
        navigate({ to: "/developer" });
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

  const recommendations = data?.recommendations ?? [];
  const summary = data?.summary ?? {
    inputFolder: "—",
    asOf: new Date().toISOString().slice(0, 10),
    filesProcessed: 0,
    ok: 0,
    highPriority: 0,
    needsOcr: 0,
  };

  // ── Filtered by FilterBar only ──────────────
  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
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

  // ── Table rows: filtered ───
  const tableRows = filtered;

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

  // Reset to page 0 whenever filters change
  useEffect(() => {
    setPage(0);
  }, [
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
        className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-secondary/60 hover:bg-slate-100 hover:border-border px-5 py-2.5 text-xs font-bold text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer animate-fade-in"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
        Export Excel{" "}
        {ids.length > 0 && <span className="text-muted-foreground">({ids.length})</span>}
      </button>
    );
  }

  const openDetail = (r: Recommendation) => {
    setSelected(r);
    setOpen(true);
  };

  if (!user && !loading) return null;

  return (
    <div className="w-full">
      {/* ── Redesigned Compact Header Area ─────────────────────────── */}
      <section className="relative py-8 md:py-12 bg-gradient-to-b from-primary/5 to-transparent border-b border-border/30">
        <div className="mx-auto w-full max-w-[1600px] px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div className="space-y-3 flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Equipment Database
              </div>
              <h1 className="font-display text-4xl font-black tracking-tight text-[#0D1117] sm:text-5xl">
                Asset & Certification <span className="text-primary italic font-semibold">Records</span>
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80 font-medium">
                Browse, filter, and manage all Worldwide Oilfield Machine (WOM) certificates of conformance. Check lifecycle statuses and trigger recertification workflows.
              </p>
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
          extraActions={
            <ExportButton
              ids={selectedIds.size > 0 ? [...selectedIds] : sortedRows.map((r) => r.id)}
            />
          }
        />
      </div>

      {/* ── Content Section (Solid White) ────────────────────────── */}
      <div className="relative bg-white pb-24 shadow-[0_-40px_80px_rgba(0,0,0,0.02)] pt-10">
        <div className="mx-auto w-full max-w-[1600px] px-8">
          <style dangerouslySetInnerHTML={{ __html: `
            .custom-scrollbar::-webkit-scrollbar {
              height: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: #F8FAFC;
              border-radius: 0 0 24px 24px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: #E2E8F0;
              border-radius: 9999px;
              border: 3px solid #F8FAFC;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: #CBD5E1;
            }
            .coc-table th {
              border-right: 1px solid #E2E8F0;
              border-bottom: 1px solid #E2E8F0;
            }
            .coc-table th:last-child {
              border-right: none;
            }
            .coc-table td {
              border-right: 1px solid #F1F5F9;
              border-bottom: 1px solid #F1F5F9;
            }
            .coc-table td:last-child {
              border-right: none;
            }
            @keyframes bounce-horizontal {
              0%, 100% {
                transform: translateX(0);
              }
              50% {
                transform: translateX(5px);
              }
            }
            .animate-bounce-horizontal {
              animation: bounce-horizontal 2.5s infinite ease-in-out;
            }
          `}} />
          {/* Spreadsheet View Header / Hint */}
          <div className="flex items-center justify-between mb-4 px-1 select-none">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary/60 animate-pulse" />
              Spreadsheet view
            </span>
            <div className="flex items-center gap-2 rounded-full bg-primary/5 border border-primary/10 px-3.5 py-1.5 text-[10.5px] font-bold text-primary animate-bounce-horizontal">
              <span>Scroll right to view more columns</span>
              <span className="text-xs font-black">→</span>
            </div>
          </div>
          {/* Table container */}
          <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/20 custom-scrollbar">
            <table className="w-full border-collapse text-left coc-table min-w-[2400px]">
              <thead>
                <tr className="bg-slate-50/75 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 select-none">
                  <th className="w-8 px-3 py-3 text-center">
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
                  </th>
                  <th className="px-3 py-3 min-w-[95px]">
                    <button
                      onClick={() => toggleSort("priority")}
                      className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer focus:outline-none"
                    >
                      Priority <SortIcon col="priority" />
                    </button>
                  </th>
                  <th className="px-3 py-3 min-w-[165px]">
                    <button
                      onClick={() => toggleSort("status")}
                      className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer focus:outline-none"
                    >
                      Status <SortIcon col="status" />
                    </button>
                  </th>
                  <th className="px-3 py-3 min-w-[130px]">Client Updates</th>
                  <th className="px-3 py-3 min-w-[180px]">
                    <button
                      onClick={() => toggleSort("customer")}
                      className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer focus:outline-none"
                    >
                      Customer <SortIcon col="customer" />
                    </button>
                  </th>
                  <th className="px-3 py-3 min-w-[110px]">Location</th>
                  <th className="px-3 py-3 min-w-[100px]">Sales Order</th>
                  <th className="px-3 py-3 min-w-[100px]">Purchase Order</th>
                  <th className="px-3 py-3 min-w-[100px]">Job / Project</th>
                  <th className="px-3 py-3 min-w-[100px]">Cert. Date</th>
                  <th className="px-3 py-3 min-w-[100px]">Tested Date</th>
                  <th className="px-3 py-3 min-w-[180px]">Equipment</th>
                  <th className="px-3 py-3 min-w-[160px]">Part Numbers</th>
                  <th className="px-3 py-3 min-w-[150px]">Serials</th>
                  <th className="px-3 py-3 min-w-[110px]">
                    <button
                      onClick={() => toggleSort("recertDue")}
                      className="flex items-center gap-1 hover:text-slate-900 transition-colors cursor-pointer focus:outline-none"
                    >
                      Recert. Due <SortIcon col="recertDue" />
                    </button>
                  </th>
                  <th className="px-3 py-3 min-w-[65px] text-center">Age</th>
                  <th className="px-3 py-3 min-w-[100px] text-center">Months</th>
                  <th className="px-3 py-3 min-w-[90px]">Confidence</th>
                  <th className="px-3 py-3 min-w-[200px]">Recommendation</th>
                  <th className="px-3 py-3 min-w-[160px]">Notes</th>
                  <th className="px-3 py-3 min-w-[160px]">Source File</th>
                  <th className="w-12 px-3 py-3 text-right"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {/* Loading */}
                {isLoading && (
                  <tr>
                    <td colSpan={22} className="py-28 text-center bg-white">
                      <div className="flex flex-col items-center justify-center gap-4">
                        <div className="relative size-12 mx-auto">
                          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                          <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">Loading records…</p>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Error */}
                {isError && (
                  <tr>
                    <td colSpan={22} className="py-28 text-center bg-white">
                      <div className="flex flex-col items-center justify-center gap-5 max-w-md mx-auto">
                        <div className="flex size-16 items-center justify-center rounded-2xl bg-destructive/8 ring-1 ring-destructive/20 mx-auto">
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
                    </td>
                  </tr>
                )}

                {/* Empty — no documents */}
                {!isLoading && !isError && recommendations.length === 0 && (
                  <tr>
                    <td colSpan={22} className="py-28 text-center bg-white">
                      <div className="flex flex-col items-center justify-center gap-5 max-w-md mx-auto">
                        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40 mx-auto">
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
                    </td>
                  </tr>
                )}

                {/* Empty — no filter match */}
                {!isLoading && !isError && recommendations.length > 0 && tableRows.length === 0 && (
                  <tr>
                    <td colSpan={22} className="py-28 text-center bg-white">
                      <div className="flex flex-col items-center justify-center gap-4 max-w-md mx-auto">
                        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.03] ring-1 ring-border/40 mx-auto">
                          <FileSearch className="size-7 text-muted-foreground/40" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">No records match your filters</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Try adjusting or clearing filters.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading &&
                  !isError &&
                  pagedRows.map((r) => {
                    const overdue = r.status === "Expired / overdue";
                    const dueSoon =
                      r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 3;
                    const ocr = r.extractionStatus !== "OK";
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
                      <tr
                        key={r.id}
                        onClick={() => openDetail(r)}
                        className={`group border-b border-slate-100 text-left transition-all duration-250 hover:bg-slate-50/40 cursor-pointer ${selectedIds.has(r.id) ? "bg-primary/[0.015] hover:bg-primary/[0.03]" : ""} ${needsReviewAsap ? "bg-amber-50/20 hover:bg-amber-50/40" : ""}`}
                      >
                        {/* Checkbox */}
                        <td
                          className="px-3 py-3 text-center align-middle"
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
                        </td>

                        {/* Priority */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-2.5">
                            {/* Priority accent bar */}
                            <div
                              className={`h-6 w-1 rounded-full ${accentColor} opacity-70 transition-all group-hover:opacity-100 group-hover:scale-y-110 shrink-0`}
                            />
                            {r.humanReviewed && r.priority === "Manual review" ? (
                              <span className="font-mono text-xs text-slate-300/60">—</span>
                            ) : (
                              <PriorityChip priority={r.priority} />
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-col gap-1">
                            {(() => {
                              let displayStatus = r.status;
                              if (r.humanReviewed && r.status === "Manual review") {
                                if (r.monthsToRecert !== null) {
                                  if (r.monthsToRecert < 0) displayStatus = "Expired / overdue";
                                  else if (r.monthsToRecert <= 12)
                                    displayStatus = "Due within 12 months";
                                  else if (r.monthsToRecert <= 24)
                                    displayStatus = "Mid-cycle service opportunity";
                                  else displayStatus = "Within lifecycle";
                                } else {
                                  return (
                                    <span className="font-mono text-xs text-slate-300/60 text-left">
                                      —
                                    </span>
                                  );
                                }
                              }
                              return <StatusBadge status={displayStatus} />;
                            })()}
                          </div>
                        </td>

                        {/* Client Updates */}
                        <td className="px-3 py-3 align-middle">
                          {(() => {
                            const linked = getLinkedAction(r.id);
                            if (!linked)
                              return (
                                <span className="font-mono text-xs text-slate-300/60">—</span>
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
                              <div className="flex flex-col gap-1">
                                {m && (
                                  <span
                                    className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold ${m.badge}`}
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
                                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-0.5">
                                      <MessageSquare className="size-3 text-slate-400" />
                                      {n} comment{n !== 1 ? "s" : ""}
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Customer */}
                        <td className="px-3 py-3 align-middle font-semibold text-slate-900 transition-colors group-hover:text-primary whitespace-nowrap" title={r.customer ?? ""}>
                          {needsReviewAsap && !r.customer ? (
                            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200/70 rounded-lg px-2 py-1 w-fit">
                              <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                              <span className="text-[10px] font-bold text-amber-700">
                                Review
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs tracking-tight leading-snug">
                              {r.customer ?? (
                                <span className="italic font-normal text-slate-400">
                                  Pending OCR
                                </span>
                              )}
                            </span>
                          )}
                        </td>

                        {/* Location */}
                        <td className="px-3 py-3 align-middle text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap" title={r.location ?? ""}>
                          {r.location ? (
                            <div className="flex items-center gap-1 bg-slate-50/50 border border-slate-100 rounded px-1.5 py-0.5 w-fit">
                              <MapPin className="size-3 text-slate-400 shrink-0" />
                              <span className="whitespace-nowrap">
                                {r.location}
                              </span>
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Sales Order */}
                        <td className="px-3 py-3 align-middle font-mono text-xs whitespace-nowrap" title={r.salesOrder ?? ""}>
                          {r.salesOrder ? (
                            <span className="bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200/60 font-semibold tracking-tight text-[11px]">
                              {r.salesOrder}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Purchase Order */}
                        <td className="px-3 py-3 align-middle font-mono text-xs whitespace-nowrap" title={r.purchaseOrder ?? ""}>
                          {r.purchaseOrder ? (
                            <span className="bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200/60 font-semibold tracking-tight text-[11px]">
                              {r.purchaseOrder}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Job / Project */}
                        <td className="px-3 py-3 align-middle font-mono text-xs whitespace-nowrap" title={r.jobOrProject ?? ""}>
                          {r.jobOrProject ? (
                            <span className="bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200/60 font-semibold tracking-tight text-[11px]">
                              {r.jobOrProject}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Certificate Date */}
                        <td className="px-3 py-3 align-middle font-mono text-xs whitespace-nowrap" title={r.certificateDate ?? ""}>
                          {r.certificateDate ? (
                            <span className="bg-slate-50/50 text-slate-600 px-1.5 py-0.5 rounded border border-slate-100 font-medium text-[11px]">
                              {r.certificateDate}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Tested Date */}
                        <td className="px-3 py-3 align-middle font-mono text-xs whitespace-nowrap" title={r.testedDate ?? ""}>
                          {r.testedDate ? (
                            <span className="bg-slate-50/50 text-slate-600 px-1.5 py-0.5 rounded border border-slate-100 font-medium text-[11px]">
                              {r.testedDate}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Equipment */}
                        <td className="px-3 py-3 align-middle max-w-[240px]">
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              const equipments = getEquipmentNames(r);
                              if (equipments.length === 0) return <span className="text-slate-300/60">—</span>;
                              
                              return (
                                <>
                                  {equipments.slice(0, 2).map((eq, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-block bg-slate-50 text-slate-800 border border-slate-200/60 rounded px-2 py-0.5 font-semibold text-[11px] leading-normal shadow-sm truncate max-w-[150px]"
                                      title={eq}
                                    >
                                      {eq}
                                    </span>
                                  ))}
                                  {equipments.length > 2 && (
                                    <HoverCard openDelay={120} closeDelay={80}>
                                      <HoverCardTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-block bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 hover:border-primary/30 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold cursor-pointer transition-all focus:outline-none"
                                        >
                                          +{equipments.length - 2} more...
                                        </button>
                                      </HoverCardTrigger>
                                      <HoverCardContent
                                        side="right"
                                        align="start"
                                        className="w-72 p-3 bg-white shadow-xl border border-slate-200 rounded-2xl z-50"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-100 pb-1.5">
                                          All Equipment ({equipments.length})
                                        </div>
                                        <div className="max-h-48 flex flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-thin">
                                          {equipments.map((eq, eqIdx) => (
                                            <span
                                              key={eqIdx}
                                              className="block bg-slate-50 text-slate-800 border border-slate-200/60 rounded p-2 font-semibold text-xs leading-normal"
                                            >
                                              {eq}
                                            </span>
                                          ))}
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </td>

                        {/* Part Numbers */}
                        <td className="px-3 py-3 align-middle max-w-[180px]">
                          <div className="flex flex-col gap-1.5">
                            {r.partNumbers && r.partNumbers.length > 0 ? (
                              <>
                                {r.partNumbers.slice(0, 2).map((p, idx) => (
                                  <div
                                    key={idx}
                                    className="text-[10px] font-mono bg-slate-50 border border-slate-200/50 rounded px-1.5 py-1 leading-tight shadow-sm"
                                  >
                                    <div className="flex items-center justify-between gap-1 border-b border-slate-200/30 pb-0.5 mb-0.5">
                                      <span className="text-slate-800 font-bold truncate max-w-[110px]" title={p.number}>{p.number}</span>
                                      {p.qty != null && (
                                        <span className="bg-primary/10 text-primary font-bold text-[8px] px-1 py-0.25 rounded shrink-0">
                                          {p.qty}x
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {r.partNumbers.length > 2 && (
                                  <HoverCard openDelay={120} closeDelay={80}>
                                    <HoverCardTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full text-center text-[9px] font-bold text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/30 rounded py-0.75 transition-all cursor-pointer mt-0.5 focus:outline-none"
                                      >
                                        +{r.partNumbers.length - 2} more...
                                      </button>
                                    </HoverCardTrigger>
                                    <HoverCardContent
                                      side="right"
                                      align="start"
                                      className="w-80 p-3 bg-white shadow-xl border border-slate-200 rounded-2xl z-50"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-100 pb-1.5">
                                        All Part Numbers ({r.partNumbers.length})
                                      </div>
                                      <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                                        {r.partNumbers.map((p, pIdx) => (
                                          <div
                                            key={pIdx}
                                            className="text-xs font-mono bg-slate-50 border border-slate-200/50 rounded p-2 leading-tight"
                                          >
                                            <div className="flex items-center justify-between gap-2 border-b border-slate-200/30 pb-1 mb-1">
                                              <span className="text-slate-800 font-bold">{p.number}</span>
                                              {p.qty != null && (
                                                <span className="bg-primary/10 text-primary font-bold text-[9px] px-1.5 py-0.5 rounded">
                                                  Qty: {p.qty}
                                                </span>
                                              )}
                                            </div>
                                            {p.description && (
                                              <span className="text-slate-500 block text-[10px] leading-normal font-sans font-medium">
                                                {p.description}
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </HoverCardContent>
                                  </HoverCard>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-300/60">—</span>
                            )}
                          </div>
                        </td>

                        {/* Serials */}
                        <td className="px-3 py-3 align-middle max-w-[180px]">
                          <div className="flex flex-wrap gap-1">
                            {r.serials && r.serials.length > 0 ? (
                              <>
                                {r.serials.slice(0, 4).map((s, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block bg-slate-50 text-slate-700 border border-slate-200/60 rounded px-1.5 py-0.25 font-mono text-[9px] font-medium tracking-tight shadow-sm"
                                  >
                                    {s}
                                  </span>
                                ))}
                                {r.serials.length > 4 && (
                                  <HoverCard openDelay={120} closeDelay={80}>
                                    <HoverCardTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-block bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 hover:border-primary/30 rounded px-1.5 py-0.25 font-mono text-[9px] font-bold cursor-pointer transition-all focus:outline-none"
                                      >
                                        +{r.serials.length - 4} more...
                                      </button>
                                    </HoverCardTrigger>
                                    <HoverCardContent
                                      side="right"
                                      align="start"
                                      className="w-72 p-3 bg-white shadow-xl border border-slate-200 rounded-2xl z-50"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-100 pb-1.5">
                                        All Serial Numbers ({r.serials.length})
                                      </div>
                                      <div className="max-h-48 flex flex-wrap gap-1 overflow-y-auto pr-1 scrollbar-thin">
                                        {r.serials.map((s, sIdx) => (
                                          <span
                                            key={sIdx}
                                            className="inline-block bg-slate-50 text-slate-700 border border-slate-200/60 rounded px-2 py-0.5 font-mono text-[10px] font-medium tracking-tight"
                                          >
                                            {s}
                                          </span>
                                        ))}
                                      </div>
                                    </HoverCardContent>
                                  </HoverCard>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-300/60">—</span>
                            )}
                          </div>
                        </td>

                        {/* Recert. Due */}
                        <td className="px-3 py-3 align-middle font-mono text-xs max-w-[110px] truncate" title={r.recertificationDue ?? ""}>
                          {r.recertificationDue ? (
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded font-semibold tracking-tight border text-[11px]",
                                overdue
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : dueSoon
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200",
                              )}
                            >
                              {r.recertificationDue}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Age (Months) */}
                        <td className="px-3 py-3 align-middle text-center font-mono text-xs whitespace-nowrap">
                          {r.ageMonths != null ? (
                            <span className="bg-slate-50 text-slate-600 px-1.5 py-0.5 rounded border border-slate-100 font-medium text-[11px] whitespace-nowrap">
                              {r.ageMonths}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Months to Recert */}
                        <td className="px-3 py-3 align-middle text-center font-mono text-xs whitespace-nowrap">
                          {r.monthsToRecert !== null ? (
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded font-bold border text-[11px] whitespace-nowrap",
                                r.monthsToRecert < 0
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : r.monthsToRecert <= 3
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : "bg-slate-50 text-slate-700 border-slate-200",
                              )}
                            >
                              {r.monthsToRecert < 0
                                ? `${Math.abs(r.monthsToRecert)} mo overdue`
                                : `in ${r.monthsToRecert} mo`}
                            </span>
                          ) : (
                            <span className="text-slate-300/60">—</span>
                          )}
                        </td>

                        {/* Confidence */}
                        <td className="px-3 py-3 align-middle">
                          {!r.humanReviewed ? (
                            (() => {
                              const score = getConfidenceScore(r);
                              const color =
                                score >= 80
                                  ? "text-emerald-600"
                                  : score >= 60
                                    ? "text-orange-500"
                                    : "text-red-500";
                              const bar =
                                score >= 80
                                  ? "bg-emerald-500"
                                  : score >= 60
                                    ? "bg-orange-500"
                                    : "bg-red-500";
                              return (
                                <div className="flex flex-col gap-1 min-w-[75px] bg-slate-50/50 border border-slate-100 rounded-lg p-1.5 w-fit">
                                  <span className={cn("font-mono text-[10px] font-bold leading-none mb-0.5", color)}>
                                    {score}%
                                  </span>
                                  <div className="h-0.75 w-12 rounded-full bg-slate-200/70 overflow-hidden">
                                    <div
                                      className={cn("h-full rounded-full", bar)}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-200/50 rounded-full px-1.5 py-0.25 font-mono text-[8px] font-bold">
                              <span className="size-1 rounded-full bg-sky-500" />
                              Reviewed
                            </span>
                          )}
                        </td>

                        {/* Recommendation */}
                        <td className="px-3 py-3 align-middle text-xs text-slate-500 max-w-[280px] truncate font-medium" title={r.recommendation ?? ""}>
                          {r.recommendation ?? <span className="text-slate-300/60">—</span>}
                        </td>

                        {/* Notes */}
                        <td className="px-3 py-3 align-middle text-xs text-slate-500 max-w-[220px] truncate font-medium" title={r.notes ?? ""}>
                          {r.notes ?? <span className="text-slate-300/60">—</span>}
                        </td>

                        {/* Source File */}
                        <td
                          className="px-3 py-3 align-middle font-mono text-[10px] text-slate-400 max-w-[220px] truncate font-semibold uppercase tracking-wide"
                          title={r.sourceFile}
                        >
                          {r.sourceFile}
                        </td>

                        {/* Actions */}
                        <td
                          className="px-3 py-3 align-middle text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDeleteId(r.id)}
                              className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 transition-all cursor-pointer focus:outline-none"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                            <ChevronRight className="size-4 text-slate-300 group-hover:text-primary transition-transform group-hover:translate-x-0.5 shrink-0" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Footer / Pagination */}
          {!isLoading && !isError && (
            <div className="mt-8 flex flex-col gap-4 border-t border-border/25 pt-6 pb-12">
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

                  <div className="flex items-center gap-1.5 px-2">
                    {Array.from({ length: totalPages }, (_, i) => i)
                      .filter((i) => Math.abs(i - page) <= 2 || i === 0 || i === totalPages - 1)
                      .reduce<(number | string)[]>((acc, i, idx, arr) => {
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

      {/* ── Floating Bulk Actions Bar ─────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 backdrop-blur-md border border-white/10 px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-5 text-white transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 select-none">
            <span className="flex size-5.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {selectedIds.size}
            </span>
            <span className="text-xs font-semibold text-slate-300">selected</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-white/5 cursor-pointer focus:outline-none"
            >
              <X className="size-3" />
              Cancel
            </button>
            <button
              onClick={() => setBulkDeleteOpen(true)}
              className="bg-destructive hover:bg-destructive/90 text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1 shadow-md shadow-destructive/20 hover:shadow-destructive/35 cursor-pointer focus:outline-none"
            >
              <Trash2 className="size-3" />
              Delete Selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
