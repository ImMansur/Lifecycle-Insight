import { useMemo, useState } from "react";
import type { Recommendation } from "@/lib/wom-data";
import { getEquipmentNames, formatRecertCountdown } from "@/lib/wom-data";
import { StatusBadge, PriorityChip } from "./StatusBadge";
import {
  Wrench,
  ChevronRight,
  AlertTriangle,
  FileSearch,
  Loader2,
  Calendar,
  BarChart3,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface EquipmentGroup {
  name: string;
  totalRecords: number;
  customers: string[];
  partNumbers: string[];
  earliestRecertDue: string | null;
  minMonthsToRecert: number | null;
  minDaysToRecert: number | null;
  highestPriority: "High" | "Low" | "Manual review";
  worstStatus: string;
  records: Recommendation[];
}

const STATUS_ORDER = [
  "Expired / overdue",
  "Due soon",
  "Mid-cycle service opportunity",
  "Manual review",
];

function groupEquipment(recs: Recommendation[]): EquipmentGroup[] {
  const map = new Map<string, EquipmentGroup>();

  for (const r of recs) {
    const equipments = getEquipmentNames(r);
    const keys = equipments.length > 0 ? equipments : ["Unidentified Equipment"];
    for (const key of keys) {
      let g = map.get(key);
      if (!g) {
        g = {
          name: key,
          totalRecords: 0,
          customers: [],
          partNumbers: [],
          earliestRecertDue: null,
          minMonthsToRecert: null,
          minDaysToRecert: null,
          highestPriority: r.priority,
          worstStatus: r.status,
          records: [],
        };
        map.set(key, g);
      }

      g.totalRecords++;
      g.records.push(r);

      if (r.customer && !g.customers.includes(r.customer)) {
        g.customers.push(r.customer);
      }
      for (const p of r.partNumbers) {
        if (!g.partNumbers.includes(p.number)) g.partNumbers.push(p.number);
      }
      if (r.monthsToRecert !== null) {
        if (g.minMonthsToRecert === null || r.monthsToRecert < g.minMonthsToRecert) {
          g.minMonthsToRecert = r.monthsToRecert;
          g.minDaysToRecert = r.daysToRecert ?? null;
          g.earliestRecertDue = r.recertificationDue;
        }
      }
      if (r.priority === "High") g.highestPriority = "High";
      const ci = STATUS_ORDER.indexOf(g.worstStatus);
      const ni = STATUS_ORDER.indexOf(r.status);
      if (ni !== -1 && (ci === -1 || ni < ci)) g.worstStatus = r.status;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const am = a.minMonthsToRecert ?? 9999;
    const bm = b.minMonthsToRecert ?? 9999;
    return am - bm;
  });
}

export function EquipmentTab({
  recommendations,
  isLoading,
  isError,
}: {
  recommendations: Recommendation[];
  isLoading: boolean;
  isError: boolean;
}) {
  const [query, setQuery] = useState("");
  const equipment = useMemo(() => groupEquipment(recommendations), [recommendations]);

  const filtered = useMemo(() => {
    if (!query.trim()) return equipment;
    const q = query.toLowerCase();
    return equipment.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.customers.some((c) => c.toLowerCase().includes(q)) ||
        e.partNumbers.some((p) => p.toLowerCase().includes(q)),
    );
  }, [equipment, query]);

  const overdueCount = equipment.filter((e) => e.worstStatus === "Expired / overdue").length;
  const highPriorityCount = equipment.filter((e) => e.highestPriority === "High").length;
  const dueSoonCount = equipment.filter((e) => e.worstStatus === "Due soon").length;

  return (
    <div className="flex-1 flex flex-col">
      {/* Page Header */}
      <section className="relative py-12 overflow-hidden">
        <div className="mx-auto max-w-[1600px] px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-6">
                <Wrench className="size-3" />
                Equipment Registry
              </div>
              <h1 className="font-display text-4xl font-black tracking-tight text-accent md:text-5xl">
                Equipment <span className="text-primary italic">Registry</span>
              </h1>
              <p className="mt-4 max-w-xl text-base text-muted-foreground/90 leading-relaxed">
                All unique equipment types extracted from ingested certificates of conformance,
                sorted by recertification urgency.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Equipment Types",
                value: isLoading ? "—" : equipment.length,
                icon: <Wrench className="size-5" />,
                tone: "default",
              },
              {
                label: "High Priority",
                value: isLoading ? "—" : highPriorityCount,
                icon: <BarChart3 className="size-5" />,
                tone: "primary",
              },
              {
                label: "Overdue",
                value: isLoading ? "—" : overdueCount,
                icon: <AlertTriangle className="size-5" />,
                tone: "destructive",
              },
              {
                label: "Due Soon",
                value: isLoading ? "—" : dueSoonCount,
                icon: <Calendar className="size-5" />,
                tone: "warning",
              },
            ].map(({ label, value, icon, tone }) => {
              const valueCls =
                tone === "primary"
                  ? "text-primary"
                  : tone === "destructive"
                    ? "text-destructive"
                    : tone === "warning"
                      ? "text-warning"
                      : "text-foreground";
              return (
                <div
                  key={label}
                  className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/30 p-5 backdrop-blur-md transition-all hover:bg-background/50 hover:border-primary/20"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                      {label}
                    </span>
                    <span className={valueCls}>{icon}</span>
                  </div>
                  <div className={`font-display text-3xl font-bold ${valueCls}`}>{value}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="border-y border-border/30 bg-background/50 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search equipment, customer, part number…"
              className="border-border/50 bg-background/20 pl-9 text-sm focus:bg-background/40 transition-colors"
            />
          </div>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
              Clear
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {filtered.length} of {equipment.length} records
          </span>
        </div>
      </section>

      {/* Table */}
      <section className="flex-1 mx-auto w-full max-w-[1600px] px-6 py-8">
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/20 backdrop-blur-md shadow-xl">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_140px_110px_24px] gap-4 border-b border-border/50 bg-foreground/[0.02] px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <div>Equipment</div>
            <div>Customers</div>
            <div>Part Numbers</div>
            <div>Recert. Due</div>
            <div>Status</div>
            <div>Priority</div>
            <div />
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <Loader2 className="size-10 animate-spin text-primary/50" />
              <p className="text-sm text-muted-foreground">Loading equipment registry…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-destructive/10 grid place-items-center">
                <AlertTriangle className="size-8 text-destructive/70" />
              </div>
              <p className="text-base font-semibold text-foreground">
                Could not load equipment data
              </p>
              <p className="text-sm text-muted-foreground">
                Check that the backend server is running.
              </p>
            </div>
          )}

          {!isLoading && !isError && equipment.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-foreground/[0.03] grid place-items-center">
                <FileSearch className="size-8 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  No equipment records found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ingest certificates of conformance on the Recommendations tab to populate this
                  registry.
                </p>
              </div>
            </div>
          )}

          {!isLoading && !isError && equipment.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <FileSearch className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No equipment matches your search.</p>
            </div>
          )}

          <div className="divide-y divide-border/30">
            {filtered.map((eq) => {
              const overdue = eq.worstStatus === "Expired / overdue";
              return (
                <div
                  key={eq.name}
                  className="group grid w-full grid-cols-[2fr_1fr_1fr_1fr_140px_110px_24px] items-center gap-4 px-6 py-5 hover:bg-foreground/[0.03] transition-all cursor-default"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-primary/10 grid place-items-center shrink-0 group-hover:bg-primary/15 transition-colors">
                      <Wrench className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {eq.name}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {eq.totalRecords} CoC{eq.totalRecords !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    {eq.customers.length === 0 ? (
                      <span className="text-muted-foreground text-sm">—</span>
                    ) : (
                      <>
                        <div className="text-sm text-foreground truncate">
                          {eq.customers.slice(0, 1).join("")}
                        </div>
                        {eq.customers.length > 1 && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                            +{eq.customers.length - 1} more
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1">
                      {eq.partNumbers.slice(0, 2).map((p) => (
                        <span
                          key={p}
                          className="rounded bg-background/40 border border-border/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                        >
                          {p}
                        </span>
                      ))}
                      {eq.partNumbers.length > 2 && (
                        <span className="font-mono text-[9px] text-muted-foreground px-0.5">
                          +{eq.partNumbers.length - 2}
                        </span>
                      )}
                      {eq.partNumbers.length === 0 && (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </div>
                  </div>

                  <div className="font-mono text-xs">
                    <div
                      className={
                        overdue ? "text-destructive font-bold" : "text-foreground font-medium"
                      }
                    >
                      {eq.earliestRecertDue ?? "—"}
                    </div>
                    {eq.minMonthsToRecert !== null && (
                      <div className="text-muted-foreground text-[10px] mt-0.5">
                        {formatRecertCountdown({
                          monthsToRecert: eq.minMonthsToRecert,
                          daysToRecert: eq.minDaysToRecert,
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <StatusBadge status={eq.worstStatus} />
                  </div>
                  <div>
                    <PriorityChip priority={eq.highestPriority} />
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground/40 transition group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              );
            })}
          </div>
        </div>

        {!isLoading && !isError && equipment.length > 0 && (
          <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground border-t border-border/30 pt-6">
            <span>
              <span className="font-bold text-foreground">{equipment.length}</span> unique equipment
              types across{" "}
              <span className="font-bold text-foreground">{recommendations.length}</span>{" "}
              certificates
            </span>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
              WOM_Equipment · v1.0.0
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
