import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchCompressionLogs, clearCompressionLogs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import {
  Sparkles,
  Database,
  Coins,
  Trash2,
  FileCheck,
  TrendingUp,
  Percent,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/logs")({
  component: LogsPage,
});

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function LogsPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Protect route
  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Developer") {
        navigate({ to: "/developer" });
      } else if (user.role === "Uploader" || user.role === "Analysis") {
        navigate({ to: "/dashboard" });
      }
    }
  }, [user, loading, navigate]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["compression-logs"],
    queryFn: fetchCompressionLogs,
    enabled: !!user && user.role !== "Uploader" && user.role !== "Analysis",
  });

  const clearMutation = useMutation({
    mutationFn: clearCompressionLogs,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compression-logs"] });
      addNotification({
        fileName: "System Logs",
        status: "success",
        message: "Cleared all compression logs successfully.",
      });
    },
    onError: (err: Error) => {
      addNotification({
        fileName: "System Logs",
        status: "error",
        message: `Failed to clear logs: ${err.message}`,
      });
    },
  });

  const logs = data?.logs || [];
  const summary = data?.summary;

  // Filter logs based on search term
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => log.filename.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [logs, searchTerm]);

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage]);

  // Recharts chart data (cumulative savings over time)
  const chartData = useMemo(() => {
    if (!logs.length) return [];
    // Sort chronologically
    const sorted = [...logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    let cumulativeStorage = 0;
    let cumulativeDi = 0;
    let cumulativeTotal = 0;

    return sorted.map((log) => {
      cumulativeStorage += log.storageSavings;
      cumulativeDi += log.diSavings;
      cumulativeTotal += log.totalSavings;

      return {
        date: new Date(log.timestamp).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        "Storage Saved ($)": parseFloat(cumulativeStorage.toFixed(2)),
        "Total Saved ($)": parseFloat(cumulativeTotal.toFixed(2)),
      };
    });
  }, [logs]);

  // Overall statistics card aggregates
  const savingsPct = useMemo(() => {
    if (!summary || summary.totalOriginalSize === 0) return 0;
    return (summary.totalSavedSize / summary.totalOriginalSize) * 100;
  }, [summary]);

  const isAdmin = useMemo(() => {
    if (!user?.role) return false;
    const r = user.role.toLowerCase();
    return r.includes("admin") || r === "fleet manager";
  }, [user?.role]);

  if (loading || !user || user.role === "Uploader" || user.role === "Analysis") {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-6 py-8 animate-in fade-in duration-500">
      {/* Header section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-6">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tight text-accent flex items-center gap-3">
            <Sparkles className="size-8 text-primary animate-pulse" /> Optimization Logs & Savings
          </h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Real-time telemetry on PDF compression rates, Firestore storage compaction, and bypassed
            Azure Document Intelligence API costs.
          </p>
        </div>
      </div>

      {/* Grid for Summary statistics */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-3xl bg-secondary/30 animate-pulse border border-border/30"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Files Processed */}
          <Card className="p-6 rounded-3xl border border-border/40 bg-surface/50 backdrop-blur-md relative overflow-hidden shadow-xl group hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  Optimized Files
                </p>
                <h3 className="text-3xl font-black tracking-tight text-foreground font-display mt-1">
                  {summary?.fileCount || 0}
                </h3>
              </div>
              <div className="p-3 bg-primary/10 rounded-2xl text-primary">
                <FileCheck className="size-6 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-3 font-semibold">
              Successfully compacted or bypassed API
            </p>
          </Card>

          {/* Card 2: Space Saved */}
          <Card className="p-6 rounded-3xl border border-border/40 bg-surface/50 backdrop-blur-md relative overflow-hidden shadow-xl group hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  Storage Compacted
                </p>
                <h3 className="text-3xl font-black tracking-tight text-foreground font-display mt-1">
                  {summary ? formatBytes(summary.totalSavedSize) : "0 Bytes"}
                </h3>
              </div>
              <div className="p-3 bg-green-500/10 rounded-2xl text-green-500">
                <Database className="size-6 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <p className="text-[11px] text-green-600 dark:text-green-500 mt-3 font-bold flex items-center gap-1">
              <Percent className="size-3.5" /> Reduced sizes by {savingsPct.toFixed(1)}%
            </p>
          </Card>


          {/* Card 4: Total Savings */}
          <Card className="p-6 rounded-3xl border border-border/40 bg-surface/50 backdrop-blur-md relative overflow-hidden shadow-xl group hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  Total Cost Saved
                </p>
                <h3 className="text-3xl font-black tracking-tight text-primary font-display mt-1">
                  ${summary?.totalSavings.toFixed(2) || "0.00"}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 rounded-2xl text-primary">
                <Coins className="size-6 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-3 font-bold flex items-center gap-1">
              <TrendingUp className="size-3.5" /> Storage + API processing savings
            </p>
          </Card>
        </div>
      )}

      {/* Chart Section */}
      {!isLoading && logs.length > 0 && (
        <Card className="p-6 rounded-3xl border border-border/40 bg-surface/50 backdrop-blur-md shadow-xl">
          <div className="space-y-1 mb-6">
            <h3 className="text-lg font-bold text-foreground font-display">
              Cumulative Savings Growth
            </h3>
            <p className="text-xs text-muted-foreground">
              Visual progression of business value saved through system optimizations.
            </p>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff7235" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ff7235" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="date" className="text-[10px] font-mono fill-muted-foreground/60" />
                <YAxis className="text-[10px] font-mono fill-muted-foreground/60" unit="$" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-surface)",
                    borderColor: "var(--color-border)",
                    borderRadius: "1rem",
                    boxShadow: "0 10px 30px -10px rgba(0,0,0,0.15)",
                  }}
                  labelClassName="text-xs font-bold font-display text-foreground mb-1"
                />
                <Area
                  type="monotone"
                  dataKey="Total Saved ($)"
                  stroke="#ff7235"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                />

                <Area
                  type="monotone"
                  dataKey="Storage Saved ($)"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Table section */}
      <Card className="rounded-3xl border border-border/40 bg-surface/50 backdrop-blur-md shadow-xl overflow-hidden">
        {/* Table Header Controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-6 border-b border-border/40">
          <h3 className="text-lg font-bold text-foreground font-display flex items-center gap-2">
            Log
            <span className="text-xs bg-primary/15 text-primary rounded-full px-2.5 py-0.5 font-bold">
              {filteredLogs.length} Entries
            </span>
          </h3>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading || isFetching}
              className="font-bold gap-2 hover:bg-secondary/60 h-10 rounded-xl text-foreground text-xs shrink-0"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm("Are you sure you want to clear all optimization and savings logs?")) {
                    clearMutation.mutate();
                  }
                }}
                disabled={clearMutation.isPending || logs.length === 0}
                className="font-bold gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive h-10 rounded-xl text-xs shrink-0"
              >
                <Trash2 className="size-3.5" />
                Clear Log
              </Button>
            )}
            <div className="relative w-48 sm:w-64">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Search by file name..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-background/50 border border-border/50 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-medium h-10"
              />
            </div>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto relative border-t border-border/20">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#ffffff] dark:bg-[#0D1117] z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
              <tr className="border-b border-border/40 bg-secondary/35 text-[10px] uppercase tracking-wider font-bold text-muted-foreground/75 font-mono">
                <th className="py-4 px-6">File Name</th>
                <th className="py-4 px-4">Original Size</th>
                <th className="py-4 px-4">Optimized Size</th>
                <th className="py-4 px-4">Pages</th>
                <th className="py-4 px-4 text-center">Azure DI Bypass</th>
                <th className="py-4 px-4 text-right">Saved Storage</th>
                <th className="py-4 px-4 text-right">Saved Azure DI</th>
                <th className="py-4 px-6 text-right text-primary">Total Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30 text-xs">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-4 px-6">
                      <div className="h-4 bg-secondary/30 rounded w-48" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-16" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-16" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-8" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-20 mx-auto" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-12 ml-auto" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-secondary/30 rounded w-12 ml-auto" />
                    </td>
                    <td className="py-4 px-6">
                      <div className="h-4 bg-secondary/30 rounded w-14 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground font-medium">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Info className="size-8 text-muted-foreground/40" />
                      <span>No optimization logs recorded yet.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => {
                  const compPct =
                    log.originalSize > 0
                      ? ((log.originalSize - log.compressedSize) / log.originalSize) * 100
                      : 0;

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-secondary/25 transition-colors font-medium text-foreground"
                    >
                      <td
                        className="py-4 px-6 font-semibold max-w-xs truncate"
                        title={log.filename}
                      >
                        {log.filename}
                      </td>
                      <td className="py-4 px-4 font-mono text-muted-foreground">
                        {formatBytes(log.originalSize)}
                      </td>
                      <td className="py-4 px-4 font-mono">
                        {formatBytes(log.compressedSize)}
                        {compPct > 0 && (
                          <span className="text-[10px] text-green-500 font-bold bg-green-500/10 px-1.5 py-0.5 rounded-md ml-2">
                            -{compPct.toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono">{log.pages || "—"}</td>
                      <td className="py-4 px-4 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            log.bypassDi
                              ? "bg-blue-500/15 text-blue-500"
                              : "bg-muted text-muted-foreground/70"
                          }`}
                        >
                          {log.bypassDi ? "Bypassed" : "No"}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-green-600 dark:text-green-500">
                        ${log.storageSavings.toFixed(4)}
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-blue-500">
                        ${log.diSavings.toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-primary font-bold">
                        ${log.totalSavings.toFixed(2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border/40 bg-secondary/5">
            <p className="text-[11px] text-muted-foreground font-semibold">
              Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length}{" "}
              events
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="size-8 p-0 rounded-lg text-foreground"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-[11px] font-mono font-bold px-2 text-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="size-8 p-0 rounded-lg text-foreground"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
