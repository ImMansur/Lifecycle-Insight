import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRecommendations } from "@/lib/api";
import {
  AlertTriangle,
  Clock,
  FileText,
  Package,
  ShieldAlert,
  Users,
  Wrench,
  Zap,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { LifecycleRulesTab } from "@/components/wom/LifecycleRulesTab";
import { Button } from "@/components/ui/button";
import {
  FilterBar,
  MetricCard,
  ChartsSection,
  wildcardMatch,
  type TimeFilter,
  type PriorityFilter,
} from "@/components/wom/HomeTab";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string | undefined) ?? "Home",
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());

  // ── All filter state lives in the URL ─────────────────────────────────────
  const activeTab = search.tab;

  // Local React states instead of URL search params to ensure instant typing response
  const [recGlobalSearch, setRecGlobalSearch] = useState("");
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
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes (was 30s — too heavy on Firestore quota)
  });

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
      
      // Global wildcard search criteria
      if (recGlobalSearch) {
        const matchesGlobal =
          wildcardMatch(r.customer, recGlobalSearch) ||
          wildcardMatch(r.location, recGlobalSearch) ||
          wildcardMatch(r.equipment, recGlobalSearch) ||
          wildcardMatch(r.salesOrder, recGlobalSearch) ||
          wildcardMatch(r.purchaseOrder, recGlobalSearch) ||
          wildcardMatch(r.sourceFile, recGlobalSearch) ||
          wildcardMatch(r.applicableSpecs, recGlobalSearch) ||
          r.partNumbers.some((p) => 
            wildcardMatch(p.number, recGlobalSearch) || 
            wildcardMatch(p.description, recGlobalSearch)
          ) ||
          (r.serials ?? []).some((s) => wildcardMatch(s, recGlobalSearch)) ||
          (r.lineItems ?? []).some((li) => 
            wildcardMatch(li.description, recGlobalSearch) ||
            wildcardMatch(li.partNumber, recGlobalSearch) ||
            (li.serials ?? []).some((s) => wildcardMatch(s, recGlobalSearch)) ||
            (li.lotBatchNumbers ?? []).some((l) => wildcardMatch(l, recGlobalSearch))
          );
        if (!matchesGlobal) return false;
      }

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
  }, [recommendations, recTimeFilter, recPriorityFilter, recGlobalSearch, recClients, recLocations, recParts, recDesc]);


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
              globalSearch={recGlobalSearch}
              setGlobalSearch={setRecGlobalSearch}
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

            {/* ── Explore Records CTA ────────────────────────────────────── */}
            <div className="mx-auto w-full max-w-[1600px] px-8 pt-20">
              <div className="rounded-3xl border border-primary/10 bg-gradient-to-tr from-primary/5 to-transparent p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-sm">
                <div className="space-y-3 text-left">
                  <h2 className="font-display text-2xl font-bold tracking-tight text-[#0D1117] sm:text-3xl">
                    Detailed Asset & Certification Records
                  </h2>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80 font-medium">
                    Access the interactive database to perform deep searches, export certificate data to Excel, update customer information, or delete records.
                  </p>
                </div>
                <Button
                  onClick={() => navigate({ to: "/records" })}
                  className="bg-primary hover:bg-primary/90 text-white font-bold h-12 px-8 rounded-xl shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30 flex items-center gap-2 group shrink-0"
                >
                  Explore Records Table
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      {activeTab === "Lifecycle Rules" && <LifecycleRulesTab />}
    </div>
  );
}
