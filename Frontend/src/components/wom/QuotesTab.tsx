import { useMemo, useState } from "react";
import type { Recommendation } from "@/lib/wom-data";
import { getEquipmentNames } from "@/lib/wom-data";
import { PriorityChip } from "./StatusBadge";
import { RecommendationDetail } from "./RecommendationDetail";
import {
  ClipboardList,
  TrendingUp,
  AlertTriangle,
  FileSearch,
  Loader2,
  ChevronRight,
  Building2,
  Calendar,
  Wrench,
  CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuotesTab({
  recommendations,
  isLoading,
  isError,
}: {
  recommendations: Recommendation[];
  isLoading: boolean;
  isError: boolean;
}) {
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Quote opportunities = high priority or overdue records
  const opportunities = useMemo(
    () =>
      recommendations
        .filter((r) => r.priority === "High" || r.status === "Expired / overdue")
        .sort((a, b) => {
          const am = a.monthsToRecert ?? 9999;
          const bm = b.monthsToRecert ?? 9999;
          return am - bm;
        }),
    [recommendations],
  );

  const overdueCount = opportunities.filter((r) => r.status === "Expired / overdue").length;
  const dueSoonCount = opportunities.filter((r) => r.status === "Due soon").length;

  const openDetail = (r: Recommendation) => {
    setSelected(r);
    setDetailOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Page Header */}
      <section className="relative py-12 overflow-hidden">
        <div className="mx-auto max-w-[1600px] px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-6">
                <ClipboardList className="size-3" />
                Quote Pipeline
              </div>
              <h1 className="font-display text-4xl font-black tracking-tight text-accent md:text-5xl">
                Quote <span className="text-primary italic">Pipeline</span>
              </h1>
              <p className="mt-4 max-w-xl text-base text-muted-foreground/90 leading-relaxed">
                Convert high-priority lifecycle recommendations into recertification quotes and
                customer proposals. Select an opportunity below to generate a quote.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Active Quotes",
                value: "0",
                sub: "No quotes created yet",
                icon: <ClipboardList className="size-5" />,
                tone: "default",
              },
              {
                label: "Open Opportunities",
                value: isLoading ? "—" : opportunities.length,
                sub: "High-priority records",
                icon: <TrendingUp className="size-5" />,
                tone: "primary",
              },
              {
                label: "Overdue",
                value: isLoading ? "—" : overdueCount,
                sub: "Immediate outreach",
                icon: <AlertTriangle className="size-5" />,
                tone: "destructive",
              },
              {
                label: "Due Soon",
                value: isLoading ? "—" : dueSoonCount,
                sub: "Within 6 months",
                icon: <Calendar className="size-5" />,
                tone: "warning",
              },
            ].map(({ label, value, sub, icon, tone }) => {
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
                  {sub && (
                    <div className="mt-1.5 text-xs text-muted-foreground/70 font-medium">{sub}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* No Active Quotes Banner */}
      <section className="mx-auto w-full max-w-[1600px] px-6 mb-6">
        <div className="rounded-2xl border border-dashed border-border/60 bg-background/20 p-10 text-center">
          <div className="mx-auto size-16 rounded-2xl bg-foreground/[0.03] grid place-items-center mb-5">
            <CircleDollarSign className="size-8 text-muted-foreground/40" />
          </div>
          <h3 className="font-display text-lg font-bold text-foreground mb-2">No active quotes</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Quotes are generated from lifecycle recommendations. Select an open opportunity below,
            review the equipment details, and click{" "}
            <span className="font-semibold text-foreground">Generate Quote</span> to create a
            proposal for the customer.
          </p>
        </div>
      </section>

      {/* Opportunities Table */}
      <section className="flex-1 mx-auto w-full max-w-[1600px] px-6 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-muted-foreground">
            Open Opportunities
          </h2>
          {!isLoading && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {opportunities.length} record{opportunities.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/20 backdrop-blur-md shadow-xl">
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_100px_160px] gap-4 border-b border-border/50 bg-foreground/[0.02] px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <div>Customer</div>
            <div>Equipment</div>
            <div>WOM SO</div>
            <div>Recert. Due</div>
            <div>Priority</div>
            <div>Action</div>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <Loader2 className="size-10 animate-spin text-primary/50" />
              <p className="text-sm text-muted-foreground">Loading opportunities…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-destructive/10 grid place-items-center">
                <AlertTriangle className="size-8 text-destructive/70" />
              </div>
              <p className="text-base font-semibold text-foreground">Could not load data</p>
              <p className="text-sm text-muted-foreground">
                Check that the backend server is running.
              </p>
            </div>
          )}

          {!isLoading && !isError && opportunities.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="size-16 rounded-full bg-foreground/[0.03] grid place-items-center">
                <FileSearch className="size-8 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No open opportunities</p>
                <p className="text-sm text-muted-foreground mt-1">
                  High-priority and overdue recommendations will appear here for quote generation.
                </p>
              </div>
            </div>
          )}

          <div className="divide-y divide-border/30">
            {opportunities.map((r) => {
              const overdue = r.status === "Expired / overdue";
              return (
                <div
                  key={r.id}
                  className="group grid w-full grid-cols-[2fr_1.5fr_1fr_1fr_100px_160px] items-center gap-4 px-6 py-5 hover:bg-foreground/[0.03] transition-all"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-accent/10 grid place-items-center shrink-0">
                      <Building2 className="size-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {r.customer ?? (
                          <span className="text-muted-foreground italic font-normal">
                            Unknown Customer
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                        {r.jobOrProject ?? r.sourceFile}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex items-center gap-2">
                    <Wrench className="size-3.5 text-muted-foreground/50 shrink-0" />
                    <div className="truncate text-sm text-foreground">
                      {(() => {
                        const equipments = getEquipmentNames(r);
                        return equipments.length > 0 ? equipments.join(", ") : <span className="text-muted-foreground">—</span>;
                      })()}
                    </div>
                  </div>

                  <div className="font-mono text-xs text-foreground font-medium">
                    {r.salesOrder ?? "—"}
                  </div>

                  <div className="font-mono text-xs">
                    <div
                      className={
                        overdue ? "text-destructive font-bold" : "text-foreground font-medium"
                      }
                    >
                      {r.recertificationDue ?? "—"}
                    </div>
                    {r.monthsToRecert !== null && (
                      <div className="text-muted-foreground text-[10px] mt-0.5">
                        {r.monthsToRecert < 0
                          ? `${Math.abs(r.monthsToRecert)} mo overdue`
                          : `In ${r.monthsToRecert} mo`}
                      </div>
                    )}
                  </div>

                  <div>
                    <PriorityChip priority={r.priority} />
                  </div>

                  <div>
                    <Button
                      size="sm"
                      onClick={() => openDetail(r)}
                      className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-xs h-8 px-3 shadow-none"
                    >
                      <ClipboardList className="mr-1.5 size-3.5" />
                      Generate Quote
                      <ChevronRight className="ml-1 size-3.5 transition group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {!isLoading && !isError && opportunities.length > 0 && (
          <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground border-t border-border/30 pt-6">
            <span>
              <span className="font-bold text-foreground">{opportunities.length}</span> open quote
              opportunities identified
            </span>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
              WOM_Quotes · v1.0.0
            </div>
          </div>
        )}
      </section>

      <RecommendationDetail rec={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
