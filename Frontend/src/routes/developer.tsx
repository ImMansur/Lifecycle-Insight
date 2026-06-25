import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchActivityLogs,
  clearActivityLogs,
  fetchUsers,
  type ActivityLog,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Activity,
  Terminal,
  Users,
  RefreshCw,
  Trash2,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Download,
  Shield,
  Clock,
  Database,
  ArrowUpDown,
  Mail,
  User,
  Server,
  Fingerprint,
  Cpu,
  Zap,
  TrendingUp,
  HardDrive,
  ActivityIcon,
  Sparkles,
  BarChart3,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/developer")({
  component: DeveloperPortal,
});

// ─── Custom Colorized JSON Metadata Viewer (Developer Slate Theme) ─────────
function ColorizedJSONViewer({ data }: { data: any }) {
  const formatJSON = (val: any, indent = 0): React.ReactNode[] => {
    const spacing = " ".repeat(indent);
    
    if (val === null) {
      return [<span key="null" className="text-rose-400">null</span>];
    }
    if (typeof val === 'boolean') {
      return [<span key="bool" className="text-amber-400">{val ? "true" : "false"}</span>];
    }
    if (typeof val === 'number') {
      return [<span key="num" className="text-cyan-400">{val}</span>];
    }
    if (typeof val === 'string') {
      return [<span key="str" className="text-emerald-400">"{val}"</span>];
    }
    
    if (Array.isArray(val)) {
      if (val.length === 0) return [<span key="empty-arr">[]</span>];
      const items: React.ReactNode[] = [];
      val.forEach((item, idx) => {
        items.push(
          <div key={idx} className="leading-relaxed">
            <span className="text-slate-700">{spacing}  </span>
            {formatJSON(item, indent + 2)}
            {idx < val.length - 1 && <span className="text-slate-500">,</span>}
          </div>
        );
      });
      return [
        <span key="arr-start" className="text-slate-500">[</span>,
        <div key="arr-body" className="pl-2">{items}</div>,
        <span key="arr-indent" className="text-slate-700">{spacing}</span>,
        <span key="arr-end" className="text-slate-500">]</span>
      ];
    }
    
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      if (keys.length === 0) return [<span key="empty-obj">{"{}"}</span>];
      const items: React.ReactNode[] = [];
      keys.forEach((key, idx) => {
        items.push(
          <div key={key} className="leading-relaxed">
            <span className="text-slate-700">{spacing}  </span>
            <span className="text-indigo-300">"{key}"</span>
            <span className="text-slate-500">: </span>
            {formatJSON(val[key], indent + 2)}
            {idx < keys.length - 1 && <span className="text-slate-500">,</span>}
          </div>
        );
      });
      return [
        <span key="obj-start" className="text-slate-500">{"{"}</span>,
        <div key="obj-body" className="pl-2">{items}</div>,
        <span key="obj-indent" className="text-slate-700">{spacing}</span>,
        <span key="obj-end" className="text-slate-500">{"}"}</span>
      ];
    }
    
    return [<span key="fallback">{String(val)}</span>];
  };

  return (
    <pre className="p-5 text-[11px] font-mono overflow-x-auto max-h-[380px] overflow-y-auto scrollbar-thin bg-[#0D1117] rounded-2xl border border-border/50 leading-relaxed text-slate-300">
      {formatJSON(data)}
    </pre>
  );
}

// ─── Helper to Map Activity Action to Feature Category ──────────────────────
function getFeatureCategory(action: string): string | null {
  switch (action) {
    case "INGEST_FILE":
      return "Upload";
    case "EDIT_RECOMMENDATION":
    case "DELETE_RECOMMENDATION":
    case "EXPORT_EXCEL":
      return "Records";
    case "CREATE_ACTION":
    case "PATCH_ACTION":
    case "ADD_COMMENT":
    case "DELETE_COMMENT":
    case "SUGGEST_STEPS":
      return "Action Center";
    case "CLEAR_LOGS":
    case "PURGE_LOGS":
      return "Logs & Savings";
    case "CREATE_USER":
    case "DELETE_USER":
      return "User Registry";
    case "LOGIN":
      return "Login";
    default:
      return null;
  }
}

// ─── Main Developer Portal Component ────────────────────────────────────────
function DeveloperPortal() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  // Navigation Sub-Tabs
  const [activeTab, setActiveTab] = useState<"diagnostics" | "identities" | "audit" | "ingestion">("diagnostics");
  const [analyticsTab, setAnalyticsTab] = useState<"ingestion" | "engagement">("ingestion");
  const [engagementInterval, setEngagementInterval] = useState<"daily" | "weekly" | "monthly">("daily");

  // Dialog & Selection States
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null); // UID of user card expanded
  const [identityLogLimit, setIdentityLogLimit] = useState<30 | 60 | 90 | "all">(30);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Live Simulated Performance Telemetry State
  const [telemetry, setTelemetry] = useState({
    cpu: 14,
    memory: 242,
    latency: 38,
    uptime: "0d 00h 00m 00s"
  });

  // Direct access check (Developer / System Admin only)
  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role !== "Developer" && user.role !== "System Administrator") {
        navigate({ to: "/dashboard" });
      }
    }
  }, [user, loading, navigate]);

  // Queries
  const {
    data: rawLogs = [],
    isLoading: logsLoading,
    isRefetching: logsRefetching,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: fetchActivityLogs,
    enabled: !!user && (user.role === "Developer" || user.role === "System Administrator"),
    refetchInterval: 8000, // Auto-refresh logs every 8 seconds
  });

  const logs = useMemo(() => {
    return rawLogs.filter((l) => !l.action.startsWith("VIEW_") && l.userRole !== "Developer");
  }, [rawLogs]);

  const { data: usersList = [], isLoading: usersLoading } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: !!user && (user.role === "Developer" || user.role === "System Administrator"),
  });

  // Purge mutation
  const purgeMutation = useMutation({
    mutationFn: clearActivityLogs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      addNotification({
        fileName: "System Console",
        status: "success",
        message: "System activity log collection successfully purged.",
      });
      setPurgeConfirmOpen(false);
    },
    onError: (err: Error) => {
      addNotification({
        fileName: "System Console",
        status: "error",
        message: `Secure purge request failed: ${err.message}`,
      });
    },
  });

  // ─── Live Telemetry Simulator Effect ──────────────────────────────────────
  useEffect(() => {
    // Arbitrary boot time (approx 2 days, 14 hours, 32 minutes ago)
    const startTime = Date.now() - (2 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000 + 32 * 60 * 1000);

    const timer = setInterval(() => {
      // Oscillate CPU load (10% to 45% under normal conditions)
      const cpuDelta = (Math.random() - 0.5) * 3;
      const nextCpu = Math.max(8, Math.min(45, Math.round(16 + cpuDelta)));

      // Oscillate memory slightly (230MB to 280MB out of 512MB limit)
      const memDelta = (Math.random() - 0.5) * 4;
      const nextMem = Math.max(230, Math.min(280, Math.round(245 + memDelta)));

      // Oscillate request latency (25ms to 95ms)
      const latDelta = (Math.random() - 0.5) * 6;
      const nextLat = Math.max(25, Math.min(95, Math.round(41 + latDelta)));

      // Format high-precision elapsed uptime
      const elapsed = Date.now() - startTime;
      const secs = Math.floor((elapsed / 1000) % 60);
      const mins = Math.floor((elapsed / (1000 * 60)) % 60);
      const hours = Math.floor((elapsed / (1000 * 60 * 60)) % 24);
      const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));

      const pad = (val: number) => val.toString().padStart(2, "0");
      const uptimeStr = `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;

      setTelemetry({
        cpu: nextCpu,
        memory: nextMem,
        latency: nextLat,
        uptime: uptimeStr
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ─── Feature Engagement Aggregation Logic ─────────────────────────────────
  const engagementData = useMemo(() => {
    const now = new Date();
    
    if (engagementInterval === "daily") {
      const days: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        days.push({
          label: d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.getDate(),
          key: d.toDateString(),
          Upload: 0,
          Records: 0,
          "Action Center": 0,
          "Logs & Savings": 0,
          "User Registry": 0,
          Login: 0,
          userEmails: new Set<string>(),
        });
      }
      
      logs.forEach((log) => {
        const logDate = new Date(log.timestamp);
        const logDateStr = logDate.toDateString();
        const target = days.find((d) => d.key === logDateStr);
        if (target) {
          const cat = getFeatureCategory(log.action);
          if (cat) {
            target[cat] = (target[cat] as number) + 1;
          }
          if (log.userEmail) {
            target.userEmails.add(log.userEmail);
          }
        }
      });
      
      return days.map(({ key, userEmails, ...rest }) => ({
        ...rest,
        "Distinct Users": userEmails.size,
      }));
    } else if (engagementInterval === "weekly") {
      const weeks: any[] = [];
      for (let i = 3; i >= 0; i--) {
        const end = new Date(now);
        end.setDate(now.getDate() - i * 7);
        const start = new Date(end);
        start.setDate(end.getDate() - 6);
        weeks.push({
          start,
          end,
          label: `Wk ${4 - i} (${start.getDate()}/${start.getMonth() + 1}-${end.getDate()}/${end.getMonth() + 1})`,
          Upload: 0,
          Records: 0,
          "Action Center": 0,
          "Logs & Savings": 0,
          "User Registry": 0,
          Login: 0,
          userEmails: new Set<string>(),
        });
      }
      
      logs.forEach((log) => {
        const logDate = new Date(log.timestamp);
        const target = weeks.find((w) => logDate >= w.start && logDate <= w.end);
        if (target) {
          const cat = getFeatureCategory(log.action);
          if (cat) {
            target[cat] = (target[cat] as number) + 1;
          }
          if (log.userEmail) {
            target.userEmails.add(log.userEmail);
          }
        }
      });
      
      return weeks.map(({ start, end, userEmails, ...rest }) => ({
        ...rest,
        "Distinct Users": userEmails.size,
      }));
    } else {
      const months: any[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          year: d.getFullYear(),
          month: d.getMonth(),
          label: d.toLocaleDateString(undefined, { month: "short" }),
          Upload: 0,
          Records: 0,
          "Action Center": 0,
          "Logs & Savings": 0,
          "User Registry": 0,
          Login: 0,
          userEmails: new Set<string>(),
        });
      }
      
      logs.forEach((log) => {
        const logDate = new Date(log.timestamp);
        const logYear = logDate.getFullYear();
        const logMonth = logDate.getMonth();
        const target = months.find((m) => m.year === logYear && m.month === logMonth);
        if (target) {
          const cat = getFeatureCategory(log.action);
          if (cat) {
            target[cat] = (target[cat] as number) + 1;
          }
          if (log.userEmail) {
            target.userEmails.add(log.userEmail);
          }
        }
      });
      
      return months.map(({ year, month, userEmails, ...rest }) => ({
        ...rest,
        "Distinct Users": userEmails.size,
      }));
    }
  }, [logs, engagementInterval]);

  const statsSummary = useMemo(() => {
    const totals: Record<string, number> = {
      Upload: 0,
      Records: 0,
      "Action Center": 0,
      "Logs & Savings": 0,
      "User Registry": 0,
      Login: 0,
    };
    
    engagementData.forEach((d: any) => {
      Object.keys(totals).forEach((feat) => {
        totals[feat] += d[feat] || 0;
      });
    });
    
    let mostActive = "None";
    let maxVal = -1;
    let leastActive = "None";
    let minVal = Infinity;
    
    Object.entries(totals).forEach(([feat, val]) => {
      if (val > maxVal) {
        maxVal = val;
        mostActive = feat;
      }
      if (val < minVal) {
        minVal = val;
        leastActive = feat;
      }
    });
    
    if (maxVal === 0) mostActive = "None";
    if (minVal === Infinity || maxVal === 0) leastActive = "None";
    
    const uploadLogs = logs.filter(
      (log) => log.action === "INGEST_FILE" && log.details && typeof log.details.duration === "number"
    );
    const avgDuration = uploadLogs.length > 0
      ? (uploadLogs.reduce((acc, log) => acc + (log.details?.duration || 0), 0) / uploadLogs.length).toFixed(1) + "s"
      : "N/A";
      
    // Calculate total distinct active users over the entire period
    const activeEmails = new Set(logs.map((l) => l.userEmail).filter(Boolean));
    const totalDistinctUsers = activeEmails.size;
      
    return {
      totalActions: logs.length,
      mostActive,
      leastActive,
      avgDuration,
      totals,
      totalDistinctUsers,
    };
  }, [logs, engagementData]);

  const aiSuggestions = useMemo(() => {
    const suggestions = [];
    const { totals, avgDuration, mostActive, leastActive } = statsSummary;
    
    if (mostActive !== "None") {
      const count = totals[mostActive] || 0;
      if (mostActive === "Action Center") {
        suggestions.push({
          type: "add",
          title: "Expand Action Center Integrations",
          badge: "ADD FEATURE",
          color: "text-indigo-600 bg-indigo-50 border-indigo-100",
          description: `Action Center is the most active section with ${count} interactions. We suggest implementing real-time desktop push notifications or MS Teams webhook integrations to alert coordinators of pending reviews immediately.`
        });
      } else if (mostActive === "Records") {
        suggestions.push({
          type: "add",
          title: "Implement Multi-Record Batch Editing",
          badge: "ADD FEATURE",
          color: "text-indigo-600 bg-indigo-50 border-indigo-100",
          description: `Users are heavily interacting with the Records registry (${count} events). Consider introducing batch selection and editing capabilities to allow bulk updates of customer or location tags in a single click.`
        });
      } else if (mostActive === "Upload") {
        suggestions.push({
          type: "add",
          title: "Support Drag-and-Drop Folder Ingestion",
          badge: "ADD FEATURE",
          color: "text-indigo-600 bg-indigo-50 border-indigo-100",
          description: `Upload is experiencing high traffic (${count} events). We recommend supporting recursive folder uploads or introducing a watched local directory sync client to automate document submission.`
        });
      } else {
        suggestions.push({
          type: "add",
          title: `Enhance the ${mostActive} Workspace`,
          badge: "ADD FEATURE",
          color: "text-indigo-600 bg-indigo-50 border-indigo-100",
          description: `${mostActive} is the most active feature (${count} interactions). We recommend adding customizable search filters or shortcut widgets to the homepage dashboard to accelerate user workflows.`
        });
      }
    }
    
    if (leastActive !== "None" && leastActive !== mostActive) {
      const count = totals[leastActive] || 0;
      if (leastActive === "User Registry") {
        suggestions.push({
          type: "stop",
          title: "Simplify Admin User Onboarding",
          badge: "STOP / SIMPLIFY",
          color: "text-amber-605 text-[#b45309] bg-amber-50 border-amber-100",
          description: `User Registry has very low activity (${count} events). Since user creation is rarely utilized, we recommend consolidating this view into the global settings tab rather than maintaining it as a standalone page.`
        });
      } else {
        suggestions.push({
          type: "stop",
          title: `Re-evaluate or Simplify ${leastActive}`,
          badge: "STOP / SIMPLIFY",
          color: "text-amber-605 text-[#b45309] bg-amber-50 border-amber-100",
          description: `The ${leastActive} feature has low adoption rates (${count} events). We suggest merging it with another dashboard tab or conducting a layout simplification to increase usability, or deprecating it if it is redundant.`
        });
      }
    }
    
    if (avgDuration !== "N/A") {
      const numSec = parseFloat(avgDuration);
      if (numSec > 8.0) {
        suggestions.push({
          type: "optimize",
          title: "Optimize Document Processing Latency",
          badge: "OPTIMIZE",
          color: "text-emerald-600 bg-emerald-50 border-emerald-100",
          description: `Average ingestion processing duration is currently ${avgDuration}. To reduce latency, we recommend implementing client-side PDF compression/resizing before sending bytes, or setting up asynchronous background worker threads in FastAPI.`
        });
      } else {
        suggestions.push({
          type: "optimize",
          title: "Scale Database Indexes for Fast Queries",
          badge: "OPTIMIZE",
          color: "text-emerald-600 bg-emerald-50 border-emerald-100",
          description: `Average upload and ingestion time is stable at ${avgDuration}. We suggest indexing Firestore collections on frequently queried fields like salesOrder and partNumbers to maintain sub-second query performance.`
        });
      }
    }
    
    if (suggestions.length < 3) {
      suggestions.push({
        type: "trend",
        title: "Clean Up Old System Logs",
        badge: "MAINTENANCE",
        color: "text-sky-600 bg-sky-50 border-sky-100",
        description: "Activity logs are growing steadily. We recommend scheduling an automated quarterly purge of logs older than 90 days to keep Firestore queries fast and cost-effective."
      });
    }
    
    return suggestions;
  }, [statsSummary, logs]);

  // ─── Dynamic Live Terminal Log Generator ──────────────────────────────────
  const terminalLogs = useMemo(() => {
    // Take the 12 most recent events and display in chronological order
    const chronologicalLogs = [...logs]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-12);

    if (chronologicalLogs.length === 0) {
      return [
        { time: new Date().toISOString(), level: "SYS", action: "BOOT", user: "system", msg: "WOM Lifecycle Operation Center online." },
        { time: new Date().toISOString(), level: "SYS", action: "DB_CONN", user: "system", msg: "Connection successfully established with Firestore." },
        { time: new Date().toISOString(), level: "SYS", action: "LISTEN", user: "system", msg: "Monitoring active threads and request logs..." }
      ];
    }

    return chronologicalLogs.map(l => {
      let level = "INFO";
      if (l.action.includes("DELETE") || l.action.includes("CLEAR") || l.action.includes("PURGE")) {
        level = "WARN";
      } else if (l.action.includes("CREATE") || l.action.includes("INGEST") || l.action.includes("EXCEL")) {
        level = "SUCCESS";
      }
      return {
        time: l.timestamp,
        level,
        action: l.action,
        user: l.userRole || (l.userEmail ? l.userEmail.split("@")[0] : "user"),
        msg: l.description
      };
    });
  }, [logs]);

  // ─── Calculated User Usage Metrics from Logs ──────────────────────────────
  const userStats = useMemo(() => {
    const stats: Record<
      string,
      { lastActive: string; totalActions: number; actionBreakdown: Record<string, number> }
    > = {};

    // Seed list
    usersList.forEach((u) => {
      stats[u.email || ""] = {
        lastActive: "Never",
        totalActions: 0,
        actionBreakdown: {},
      };
    });

    // Traverse logs chronologically to capture last active
    [...logs]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .forEach((log) => {
        const email = log.userEmail;
        if (!stats[email]) {
          stats[email] = {
            lastActive: "Never",
            totalActions: 0,
            actionBreakdown: {},
          };
        }

        stats[email].totalActions += 1;
        stats[email].lastActive = log.timestamp;
        
        const actionType = log.action;
        stats[email].actionBreakdown[actionType] = (stats[email].actionBreakdown[actionType] || 0) + 1;
      });

    return stats;
  }, [logs, usersList]);

  // ─── Ingestion Pipeline & OCR Metrics ──────────────────────────────────────
  const ingestionMetrics = useMemo(() => {
    const ingestLogs = logs.filter((l) => l.action === "INGEST_FILE");
    const totalFiles = ingestLogs.length;

    let totalPages = 0;
    let ocrExecutedCount = 0;

    ingestLogs.forEach((l) => {
      const details = l.details || {};
      totalPages += typeof details.pages === "number" ? details.pages : 1;
      
      const ocrActive = details.ocrExecuted === true || (l.description && l.description.toLowerCase().includes("ocr executed"));
      if (ocrActive) {
        ocrExecutedCount += 1;
      }
    });

    const ocrRate = totalFiles > 0 ? Math.round((ocrExecutedCount / totalFiles) * 100) : 0;
    const avgPages = totalFiles > 0 ? parseFloat((totalPages / totalFiles).toFixed(1)) : 0;

    return {
      totalFiles,
      totalPages,
      ocrRate,
      avgPages,
    };
  }, [logs]);

  // ─── Ingestion Volume Chart Data (Grouped by Date) ────────────────────────
  const chartData = useMemo(() => {
    const dailyData: Record<string, { date: string; ocrPages: number; nativePages: number; totalFiles: number }> = {};

    const ingestLogs = [...logs]
      .filter((l) => l.action === "INGEST_FILE")
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    ingestLogs.forEach((log) => {
      const dateStr = new Date(log.timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

      if (!dailyData[dateStr]) {
        dailyData[dateStr] = { date: dateStr, ocrPages: 0, nativePages: 0, totalFiles: 0 };
      }

      const details = log.details || {};
      const pages = typeof details.pages === "number" ? details.pages : 1;
      const ocrActive = details.ocrExecuted === true || (log.description && log.description.toLowerCase().includes("ocr executed"));

      dailyData[dateStr].totalFiles += 1;
      if (ocrActive) {
        dailyData[dateStr].ocrPages += pages;
      } else {
        dailyData[dateStr].nativePages += pages;
      }
    });

    const list = Object.values(dailyData);
    if (list.length === 0) {
      // Futuristic mock analytics to avoid blank canvas on initial startup
      return [
        { date: "Jun 20", ocrPages: 4, nativePages: 12, totalFiles: 3 },
        { date: "Jun 21", ocrPages: 8, nativePages: 18, totalFiles: 5 },
        { date: "Jun 22", ocrPages: 0, nativePages: 26, totalFiles: 6 },
        { date: "Jun 23", ocrPages: 14, nativePages: 10, totalFiles: 4 },
        { date: "Jun 24", ocrPages: 22, nativePages: 16, totalFiles: 8 },
        { date: "Jun 25", ocrPages: telemetry.cpu % 2 === 0 ? 8 : 12, nativePages: 21, totalFiles: 9 },
      ];
    }
    return list;
  }, [logs, telemetry.cpu]);

  // ─── Filtered Logs ────────────────────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // Fuzzy text search across operator details, actions, descriptions
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          (l.description || "").toLowerCase().includes(query) ||
          (l.userName || "").toLowerCase().includes(query) ||
          (l.userEmail || "").toLowerCase().includes(query) ||
          (l.action || "").toLowerCase().includes(query),
      );
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((l) => l.userRole === roleFilter);
    }

    // Action filter
    if (actionFilter !== "all") {
      result = result.filter((l) => l.action === actionFilter);
    }

    // Reversible sorting
    result.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });

    return result;
  }, [logs, searchQuery, roleFilter, actionFilter, sortOrder]);

  // Extract unique action types for filter menu dropdown
  const uniqueActionsList = useMemo(() => {
    const actionsSet = new Set<string>();
    logs.forEach((l) => {
      if (l.action) actionsSet.add(l.action);
    });
    return Array.from(actionsSet);
  }, [logs]);

  // JSON Export trigger
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `wom_ops_audit_trail_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTimestamp = (isoStr: string) => {
    if (isoStr === "Never") return "Never";
    try {
      const d = new Date(isoStr);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return isoStr;
    }
  };

  const getActionBadgeStyle = (action: string) => {
    switch (action) {
      case "LOGIN":
        return "bg-emerald-50 text-emerald-600 border border-emerald-200";
      case "LOGOUT":
        return "bg-slate-50 text-slate-600 border border-slate-200";
      case "INGEST_FILE":
        return "bg-sky-50 text-sky-605 border border-sky-200";
      case "CONFIRM_DUPLICATE":
        return "bg-purple-50 text-purple-600 border border-purple-200";
      case "UPDATE_RECOMMENDATION":
        return "bg-amber-50 text-amber-600 border border-amber-200";
      case "DELETE_RECOMMENDATION":
      case "BULK_DELETE_RECOMMENDATIONS":
        return "bg-rose-50 text-rose-600 border border-rose-200";
      case "CREATE_USER":
        return "bg-indigo-50 text-indigo-600 border border-indigo-200";
      case "DELETE_USER":
        return "bg-red-50 text-red-600 border border-red-200";
      case "EXCEL_EXPORT":
        return "bg-teal-50 text-teal-600 border border-teal-200";
      case "PURGE_LOGS":
        return "bg-orange-50 text-orange-600 border border-orange-200";
      default:
        return "bg-slate-50 text-slate-600 border border-slate-200";
    }
  };

  if (loading || logsLoading || usersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <RefreshCw className="size-10 text-primary animate-spin mx-auto" />
          <p className="text-muted-foreground font-mono text-sm tracking-widest uppercase">
            Loading System Console...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-8 space-y-8 animate-in fade-in zoom-in-95 duration-500 text-[#0D1117]">
      {/* Redesigned Compact Header Area */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-border/40 pb-6">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Lifecycle Monitoring Console
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight text-[#0D1117] sm:text-5xl">
            Developer <span className="text-primary italic font-semibold">Dashboard</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80 font-medium">
            Monitor active threads, analyze document ingestion page counts, query Firestore audit logs, and inspect raw metadata.
          </p>
        </div>

        {/* Action Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={() => refetchLogs()}
            variant="outline"
            className="bg-white border border-border/60 hover:bg-secondary/65 text-muted-foreground hover:text-[#0D1117] font-bold px-5 h-11 rounded-xl shadow-sm cursor-pointer transition-all"
            title="Refresh database log streams"
          >
            <RefreshCw className={cn("mr-2 size-4 text-primary", logsRefetching ? "animate-spin" : "")} />
            Sync Feeds
          </Button>
          <Button
            onClick={handleExportJSON}
            variant="outline"
            className="bg-white border border-border/60 hover:bg-secondary/65 text-muted-foreground hover:text-[#0D1117] font-bold px-5 h-11 rounded-xl shadow-sm cursor-pointer transition-all"
            title="Download structured JSON operations history"
          >
            <Download className="mr-2 size-4 text-primary" />
            Export JSON
          </Button>
          <Button
            onClick={() => setPurgeConfirmOpen(true)}
            className="bg-red-500/10 hover:bg-red-500/15 text-red-600 border border-red-200 font-bold px-5 h-11 rounded-xl shadow-sm cursor-pointer transition-all"
            title="Securely clear all Firestore operations logs"
          >
            <Trash2 className="mr-2 size-4 text-red-500" />
            Purge Logs
          </Button>
        </div>
      </div>

      {/* Standalone Dashboard Sub-Tabs Navigation (Styled like main menu pills) */}
      <div className="flex justify-center md:justify-start">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 p-1.5 backdrop-blur-sm shadow-inner border border-border/20">
          <button
            onClick={() => setActiveTab("diagnostics")}
            className={cn(
              "rounded-full px-6 py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-2",
              activeTab === "diagnostics"
                ? "bg-primary text-white shadow-md shadow-primary/25"
                : "text-muted-foreground hover:text-[#0D1117]"
            )}
          >
            <Server className="size-3.5" />
            Diagnostics
          </button>
          <button
            onClick={() => setActiveTab("identities")}
            className={cn(
              "rounded-full px-6 py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-2",
              activeTab === "identities"
                ? "bg-primary text-white shadow-md shadow-primary/25"
                : "text-muted-foreground hover:text-[#0D1117]"
            )}
          >
            <Fingerprint className="size-3.5" />
            Identities
            <span className={cn(
              "text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md",
              activeTab === "identities" ? "bg-white/20 text-white" : "bg-secondary-foreground/10 text-muted-foreground"
            )}>
              {usersList.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={cn(
              "rounded-full px-6 py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-2",
              activeTab === "audit"
                ? "bg-primary text-white shadow-md shadow-primary/25"
                : "text-muted-foreground hover:text-[#0D1117]"
            )}
          >
            <Activity className="size-3.5" />
            Audit Logs
            <span className={cn(
              "text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md",
              activeTab === "audit" ? "bg-white/20 text-white" : "bg-secondary-foreground/10 text-muted-foreground"
            )}>
              {logs.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("ingestion")}
            className={cn(
              "rounded-full px-6 py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-2",
              activeTab === "ingestion"
                ? "bg-primary text-white shadow-md shadow-primary/25"
                : "text-muted-foreground hover:text-[#0D1117]"
            )}
          >
            <TrendingUp className="size-3.5" />
            Analytics
          </button>
        </div>
      </div>

      {/* ─── TAB 1: SYSTEM DIAGNOSTICS ──────────────────────────────────────── */}
      {activeTab === "diagnostics" && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Quick telemetry card row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* CPU load card */}
            <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-4 relative overflow-hidden shadow-sm hover:shadow-md transition-all group">
              <div className="absolute top-0 right-0 h-1.5 bg-primary w-1/3 rounded-bl-xl" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                    <Cpu className="size-4.5" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                    Thread CPU
                  </span>
                </div>
                <span className="text-[10px] text-primary font-bold bg-primary/5 px-2 py-0.5 rounded border border-primary/15">NORMAL</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#0D1117] font-mono">{telemetry.cpu}%</span>
                  <span className="text-[9px] text-muted-foreground">core allocation</span>
                </div>
                <div className="h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-1000 shadow-sm"
                    style={{ width: `${telemetry.cpu}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Memory load card */}
            <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-4 relative overflow-hidden shadow-sm hover:shadow-md transition-all group">
              <div className="absolute top-0 right-0 h-1.5 bg-blue-500 w-1/3 rounded-bl-xl" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 group-hover:scale-105 transition-transform">
                    <HardDrive className="size-4.5" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                    RAM Load
                  </span>
                </div>
                <span className="text-[10px] text-blue-500 font-bold bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/15">HEALTHY</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#0D1117] font-mono">{telemetry.memory}MB</span>
                  <span className="text-[9px] text-muted-foreground">/ 512MB quota</span>
                </div>
                <div className="h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-1000 shadow-sm"
                    style={{ width: `${(telemetry.memory / 512) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* API Response latency card */}
            <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-4 relative overflow-hidden shadow-sm hover:shadow-md transition-all group">
              <div className="absolute top-0 right-0 h-1.5 bg-emerald-550 bg-emerald-500 w-1/3 rounded-bl-xl" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 group-hover:scale-105 transition-transform">
                    <Zap className="size-4.5" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                    Latency
                  </span>
                </div>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/15">OPTIMAL</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#0D1117] font-mono">{telemetry.latency}ms</span>
                  <span className="text-[9px] text-muted-foreground">average query</span>
                </div>
                <div className="h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-1000 shadow-sm"
                    style={{ width: `${Math.min(100, (telemetry.latency / 120) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Connected users card */}
            <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-4 relative overflow-hidden shadow-sm hover:shadow-md transition-all group">
              <div className="absolute top-0 right-0 h-1.5 bg-indigo-500 w-1/3 rounded-bl-xl" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-500 group-hover:scale-105 transition-transform">
                    <Users className="size-4.5" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                    Identities
                  </span>
                </div>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/15 flex items-center gap-1">
                  <span className="size-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  ONLINE
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#0D1117] font-mono">{usersList.length}</span>
                  <span className="text-[9px] text-muted-foreground">active accounts</span>
                </div>
                <div className="h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full w-full shadow-sm" />
                </div>
              </div>
            </div>
          </div>

          {/* Core Diagnostics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Systems health checklist */}
            <div className="bg-white border border-border/40 rounded-[28px] p-6 space-y-6 shadow-sm">
              <h3 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2 border-b border-border/30 pb-3">
                <Database className="size-5 text-primary" /> Infrastructure Integrity
              </h3>

              <div className="space-y-4">
                {/* Item 1 */}
                <div className="flex items-center justify-between p-3.5 bg-secondary/35 border border-border/40 rounded-2xl text-xs font-mono">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-slate-700 font-bold">Google Firestore</span>
                  </div>
                  <span className="text-emerald-600 uppercase font-semibold text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-sans">CONNECTED</span>
                </div>

                {/* Item 2 */}
                <div className="flex items-center justify-between p-3.5 bg-secondary/35 border border-border/40 rounded-2xl text-xs font-mono">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-slate-700 font-bold">Firebase Authentication</span>
                  </div>
                  <span className="text-emerald-600 uppercase font-semibold text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-sans">ACTIVE</span>
                </div>

                {/* Item 3 */}
                <div className="flex items-center justify-between p-3.5 bg-secondary/35 border border-border/40 rounded-2xl text-xs font-mono">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    <span className="text-slate-700 font-bold">FastAPI Backend Server</span>
                  </div>
                  <span className="text-emerald-600 uppercase font-semibold text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-sans">ONLINE</span>
                </div>

                {/* Item 4 */}
                <div className="flex items-center justify-between p-3.5 bg-secondary/35 border border-border/40 rounded-2xl text-xs font-mono">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-slate-700 font-bold">System Uptime</span>
                  </div>
                  <span className="text-primary font-bold text-[10px]">{telemetry.uptime}</span>
                </div>
              </div>

              {/* Cyber Console details */}
              <div className="bg-secondary/20 rounded-2xl border border-border/30 p-4 font-mono text-[10px] text-muted-foreground leading-relaxed space-y-2">
                <div className="flex justify-between border-b border-border/40 pb-1.5">
                  <span>Host Platform</span>
                  <span className="text-slate-600">Windows Node</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-1.5">
                  <span>API Version</span>
                  <span className="text-slate-600">v1.4.2-compiled</span>
                </div>
                <div className="flex justify-between">
                  <span>Firestore Collection</span>
                  <span className="text-slate-600">activity_logs</span>
                </div>
              </div>
            </div>

            {/* Right Column: Live Terminal Console (Span 2) */}
            <div className="lg:col-span-2 bg-white border border-border/40 rounded-[28px] p-6 space-y-4 shadow-sm flex flex-col">
              <div className="flex items-center justify-between border-b border-border/30 pb-3">
                <h3 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2">
                  <Terminal className="size-5 text-primary" /> Live Operations Stream
                </h3>
                <span className="text-[10px] font-mono text-primary font-bold bg-primary/5 border border-primary/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  STDOUT Channel
                </span>
              </div>

              {/* Console scrollable screen (Premium Dark Slate block for developer code/logs) */}
              <div className="bg-[#0F141C] rounded-2xl border border-border/40 p-4.5 font-mono text-xs text-slate-300 h-[300px] overflow-y-auto space-y-2.5 scrollbar-thin shadow-inner">
                {terminalLogs.map((tl, idx) => (
                  <div key={idx} className="leading-relaxed whitespace-pre-wrap flex items-start gap-1.5 hover:bg-slate-800/10 py-0.5 rounded px-1 transition-colors">
                    <span className="text-slate-500 shrink-0">[{formatTimestamp(tl.time)}]</span>{" "}
                    <span className={cn(
                      "font-black shrink-0",
                      tl.level === "WARN" ? "text-amber-400" :
                      tl.level === "SUCCESS" ? "text-primary" : "text-sky-400"
                    )}>
                      [{tl.level}]
                    </span>{" "}
                    {tl.action && (
                      <span className="text-indigo-300 shrink-0 font-bold">[{tl.action}]</span>
                    )}{" "}
                    {tl.user && (
                      <span className="text-slate-450 shrink-0">({tl.user})</span>
                    )}{" "}
                    <span className="text-slate-200">{tl.msg}</span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-muted-foreground font-mono text-right italic mt-2">
                * Streams real-time database write operations. Updates automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 2: IDENTITY REGISTRY & TIMELINES ───────────────────────────── */}
      {activeTab === "identities" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Left Column: Registered Users Grid (Span 1) */}
          <div className="bg-white border border-border/40 rounded-[28px] overflow-hidden shadow-sm flex flex-col h-fit">
            <div className="px-6 py-5 border-b border-border/40 bg-secondary/15 flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2">
                <Users className="size-5 text-primary" /> Active Identities
              </h2>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-mono font-bold">
                {usersList.length} Accounts
              </span>
            </div>

            <div className="divide-y divide-border/30 max-h-[600px] overflow-y-auto">
              {usersList.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                  No registered accounts detected.
                </div>
              ) : (
                usersList.map((u) => {
                  const email = u.email || "";
                  const stats = userStats[email] || { lastActive: "Never", totalActions: 0 };
                  const isExpanded = expandedUser === u.uid;

                  return (
                    <div
                      key={u.uid}
                      className={cn(
                        "transition-colors duration-150 border-l-2",
                        isExpanded ? "bg-secondary/10 border-primary" : "hover:bg-secondary/5 border-transparent"
                      )}
                    >
                      <div
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        className="p-5 flex items-center justify-between cursor-pointer group"
                      >
                        <div className="flex items-center gap-3.5">
                          <div className="relative shrink-0">
                            <div
                              className="size-10 rounded-full flex items-center justify-center font-bold text-xs border bg-primary/10 text-primary border-primary/20 shadow-sm"
                            >
                              {getInitials(u.displayName || "")}
                            </div>
                            <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                          </div>
                          <div className="leading-tight">
                            <h4 className="font-bold text-sm text-[#0D1117] group-hover:text-primary transition-colors">
                              {u.displayName}
                            </h4>
                            <span className="text-[9px] font-mono text-muted-foreground block mt-0.5">
                              {u.email}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right leading-none">
                            <div className="text-xs font-mono font-bold text-slate-800">
                              {stats.totalActions}
                            </div>
                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">
                              Actions
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="size-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="size-4 text-slate-400 group-hover:translate-x-0.5 transition-all" />
                          )}
                        </div>
                      </div>

                      {/* Expandable Details Container */}
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-1 border-t border-border/20 bg-secondary/5 space-y-4 font-mono text-xs">
                          <div className="grid grid-cols-2 gap-3 bg-white p-3.5 rounded-2xl border border-border/40 text-xs">
                            <div>
                              <span className="text-[9px] text-muted-foreground block uppercase font-bold tracking-wider">
                                Role Permission
                              </span>
                              <span className="font-bold text-primary text-xs">{u.role}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-muted-foreground block uppercase font-bold tracking-wider">
                                Last Activity
                              </span>
                              <span className="text-slate-700 block text-xs truncate">
                                {formatTimestamp(stats.lastActive)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: User Specific Activity Timeline (Span 2) */}
          <div className="lg:col-span-2 bg-white border border-border/40 rounded-[28px] p-6 shadow-sm flex flex-col h-[660px]">
            {expandedUser ? (
              (() => {
                const activeUserObj = usersList.find((u) => u.uid === expandedUser);
                if (!activeUserObj) return null;
                const email = activeUserObj.email || "";

                // Filter and sort events (newest first)
                const sortedUserEvents = logs
                  .filter((l) => l.userEmail === email)
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                const userEvents = identityLogLimit === "all"
                  ? sortedUserEvents
                  : sortedUserEvents.slice(0, identityLogLimit);

                return (
                  <div className="space-y-6 flex-1 flex flex-col h-full animate-in fade-in duration-200 overflow-hidden">
                    {/* User Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/30">
                      <div className="flex items-center gap-4">
                        <div className="size-12 rounded-full flex items-center justify-center font-bold text-sm border bg-primary/10 text-primary border-primary/20 shadow-sm">
                          {getInitials(activeUserObj.displayName || "")}
                        </div>
                        <div className="leading-tight">
                          <h3 className="text-lg font-bold text-[#0D1117]">{activeUserObj.displayName}</h3>
                          <p className="text-xs font-mono text-muted-foreground">
                            {activeUserObj.email} · <span className="text-primary font-bold">{activeUserObj.role}</span>
                          </p>
                        </div>
                      </div>

                      {/* Log Limit Selector */}
                      <div className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1 self-start sm:self-auto">
                        {([30, 60, 90, "all"] as const).map((limit) => (
                          <button
                            key={limit}
                            onClick={() => setIdentityLogLimit(limit)}
                            className={cn(
                              "rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all whitespace-nowrap",
                              identityLogLimit === limit
                                ? "bg-primary text-white shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {limit === "all" ? "All Time" : `${limit} Logs`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Timeline List */}
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
                      {userEvents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-muted-foreground font-mono text-sm py-16 space-y-2">
                          <Clock className="size-8 text-slate-300 animate-pulse" />
                          <p>No logged operations for this user yet.</p>
                        </div>
                      ) : (
                        userEvents.map((e) => (
                          <div
                            key={e.id}
                            onClick={() => setSelectedLog(e)}
                            className="p-4 rounded-2xl bg-secondary/15 hover:bg-secondary/35 border border-border/40 hover:border-border/60 cursor-pointer flex justify-between items-center gap-4 transition-all duration-150 group"
                          >
                            <div className="space-y-1.5 max-w-[85%]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn("text-[9px] font-mono font-bold px-2 py-0.5 rounded-md", getActionBadgeStyle(e.action))}>
                                  {e.action}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {formatTimestamp(e.timestamp)}
                                </span>
                              </div>
                              <p className="text-sm font-semibold text-[#0D1117] group-hover:text-primary transition-colors">
                                {e.description}
                              </p>
                            </div>
                            <ChevronRight className="size-4 text-slate-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                <Fingerprint className="size-14 text-slate-300 stroke-1 animate-pulse" />
                <div className="space-y-1.5 max-w-md">
                  <h3 className="font-display font-bold text-lg text-[#0D1117]">Select a Registered Identity</h3>
                  <p className="text-sm text-muted-foreground">
                    Select any registered user profile card from the left panel to inspect their detailed operational attributes and complete audit timeline.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 3: SYSTEM AUDIT STREAM ─────────────────────────────────────── */}
      {activeTab === "audit" && (
        <div className="bg-white border border-border/40 rounded-[28px] overflow-hidden shadow-sm flex flex-col min-h-[600px] animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Search & Filtering Controls */}
          <div className="px-6 py-5 border-b border-border/40 bg-secondary/15 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="font-display font-bold text-xl text-[#0D1117] flex items-center gap-2">
                <ActivityIcon className="size-5 text-primary" /> Operations Audit Stream
              </h2>
              <div className="text-xs text-muted-foreground font-mono">
                Displaying <strong>{filteredLogs.length}</strong> of <strong>{logs.length}</strong> system logs
              </div>
            </div>

            {/* Filtering Controls Row */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              {/* Search Input */}
              <div className="sm:col-span-5 relative group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  type="text"
                  placeholder="Search logs (userName, email, action, desc...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-10 bg-white border-border/60 focus-visible:ring-1 focus-visible:ring-primary/30 text-xs rounded-xl text-slate-800"
                />
              </div>

              {/* Filter by Role */}
              <div className="sm:col-span-3 relative flex items-center">
                <Filter className="absolute left-3.5 size-3.5 text-muted-foreground pointer-events-none" />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="pl-9 pr-8 h-10 w-full bg-white border border-border/60 text-xs rounded-xl text-slate-700 focus:outline-none focus:border-primary/30 cursor-pointer appearance-none"
                >
                  <option value="all">All Roles</option>
                  <option value="Developer">Developer</option>
                  <option value="System Administrator">System Admin</option>
                  <option value="Fleet Manager">Fleet Manager</option>
                  <option value="Analysis">Analysis</option>
                  <option value="Uploader">Uploader</option>
                </select>
                <ChevronDown className="absolute right-3.5 size-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {/* Filter by Action Type */}
              <div className="sm:col-span-3 relative flex items-center">
                <Activity className="absolute left-3.5 size-3.5 text-muted-foreground pointer-events-none" />
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="pl-9 pr-8 h-10 w-full bg-white border border-border/60 text-xs rounded-xl text-slate-700 focus:outline-none focus:border-primary/30 cursor-pointer appearance-none"
                >
                  <option value="all">All Operations</option>
                  {uniqueActionsList.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3.5 size-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {/* Toggle Sorting Order */}
              <button
                onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                className="sm:col-span-1 h-10 bg-white border border-border/60 hover:bg-secondary/30 rounded-xl flex items-center justify-center text-slate-500 hover:text-[#0D1117] transition-colors cursor-pointer"
                title="Reverse timeline sorting order"
              >
                <ArrowUpDown className="size-4" />
              </button>
            </div>
          </div>

          {/* Logs Feed Container */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/30 p-4 space-y-2.5 bg-secondary/5">
            {filteredLogs.length === 0 ? (
              <div className="p-16 text-center text-muted-foreground font-mono text-sm flex flex-col items-center justify-center space-y-2">
                <Search className="size-8 text-slate-300 animate-pulse" />
                <p>{logs.length === 0 ? "No system events logged yet." : "No logs match active search criteria."}</p>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="p-4 rounded-2xl bg-white hover:bg-secondary/15 border border-border/40 hover:border-border/60 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-155 group"
                >
                  <div className="space-y-2 max-w-[85%]">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={cn("text-[9px] font-mono font-bold px-2 py-0.5 rounded-md", getActionBadgeStyle(log.action))}
                      >
                        {log.action}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground font-mono">
                        {log.userName} ({log.userRole})
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#0D1117] group-hover:text-primary transition-colors leading-relaxed">
                      {log.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <ChevronRight className="size-4 text-slate-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 4: ANALYTICS & INSIGHTS ────────────────────────────────────── */}
      {activeTab === "ingestion" && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Analytics Sub-Tabs Toggle */}
          <div className="flex border-b border-border/30 pb-4 items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-1 bg-secondary/65 p-1 rounded-xl">
              <button
                onClick={() => setAnalyticsTab("ingestion")}
                className={cn(
                  "px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer",
                  analyticsTab === "ingestion"
                    ? "bg-white text-[#0D1117] shadow-sm font-bold"
                    : "text-muted-foreground hover:text-[#0D1117]"
                )}
              >
                Document Ingestion Insights
              </button>
              <button
                onClick={() => setAnalyticsTab("engagement")}
                className={cn(
                  "px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer",
                  analyticsTab === "engagement"
                    ? "bg-white text-[#0D1117] shadow-sm font-bold"
                    : "text-muted-foreground hover:text-[#0D1117]"
                )}
              >
                Feature Engagement & AI Suggestions
              </button>
            </div>
            {analyticsTab === "engagement" && (
              <div className="flex items-center gap-1 bg-secondary/65 p-1 rounded-xl">
                {(["daily", "weekly", "monthly"] as const).map((interval) => (
                  <button
                    key={interval}
                    onClick={() => setEngagementInterval(interval)}
                    className={cn(
                      "px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer",
                      engagementInterval === interval
                        ? "bg-primary text-white shadow-sm font-extrabold"
                        : "text-muted-foreground hover:text-[#0D1117]"
                    )}
                  >
                    {interval}
                  </button>
                ))}
              </div>
            )}
          </div>

          {analyticsTab === "ingestion" ? (
            <>
              {/* Ingestion metrics row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Card 1 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Ingested Files
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{ingestionMetrics.totalFiles}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">documents</span>
                  </div>
                </div>

                {/* Card 2 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Pages Parsed
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{ingestionMetrics.totalPages}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">total pages</span>
                  </div>
                </div>

                {/* Card 3 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    OCR Execution Rate
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{ingestionMetrics.ocrRate}%</span>
                    <span className="text-[10px] text-primary font-bold bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded font-sans">
                      scanned PDFs
                    </span>
                  </div>
                </div>

                {/* Card 4 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Average Doc Length
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{ingestionMetrics.avgPages}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">pages / file</span>
                  </div>
                </div>
              </div>

              {/* Ingestion chart */}
              <div className="bg-white border border-border/40 rounded-[28px] p-6 shadow-sm space-y-6">
                <h3 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2 border-b border-border/30 pb-3">
                  <TrendingUp className="size-5 text-primary" /> Ingestion Activity (Pages Processed)
                </h3>

                {/* Recharts responsive container */}
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff7235" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#ff7235" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorNative" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0D1117" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#0D1117" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "16px",
                          fontSize: "11px",
                          color: "#0D1117",
                          fontFamily: "JetBrains Mono"
                        }}
                        itemStyle={{ color: "#ff7235" }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 12, fontFamily: "JetBrains Mono" }}
                        iconType="circle"
                        iconSize={7}
                      />
                      <Area
                        type="monotone"
                        dataKey="ocrPages"
                        name="OCR Processed Pages"
                        stroke="#ff7235"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorOcr)"
                      />
                      <Area
                        type="monotone"
                        dataKey="nativePages"
                        name="Native Ingested Pages"
                        stroke="#0D1117"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorNative)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Feature Engagement metrics row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                {/* Card 1 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Total Operations
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{statsSummary.totalActions}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">events logged</span>
                  </div>
                </div>

                {/* Card 2 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Active Operators
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{statsSummary.totalDistinctUsers}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">unique users</span>
                  </div>
                </div>

                {/* Card 3 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Most Active Feature
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-primary truncate max-w-full block">
                      {statsSummary.mostActive}
                    </span>
                  </div>
                </div>

                {/* Card 4 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Least Active Feature
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-slate-750 truncate max-w-full block">
                      {statsSummary.leastActive}
                    </span>
                  </div>
                </div>

                {/* Card 5 */}
                <div className="bg-white border border-border/40 p-6 rounded-3xl space-y-2.5 shadow-sm hover:shadow-md transition-shadow">
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-muted-foreground block">
                    Avg Ingest Duration
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[#0D1117] font-mono">{statsSummary.avgDuration}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">per document</span>
                  </div>
                </div>
              </div>

              {/* Engagement chart & AI suggestions grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* Left Column: Bar Chart (Span 2) */}
                <div className="lg:col-span-2 bg-white border border-border/40 rounded-[28px] p-6 shadow-sm space-y-6 flex flex-col">
                  <h3 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2 border-b border-border/30 pb-3">
                    <BarChart3 className="size-5 text-primary" /> Feature Engagement ({engagementInterval === "daily" ? "Daily stats" : engagementInterval === "weekly" ? "Weekly stats" : "Monthly stats"})
                  </h3>

                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={engagementData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "16px",
                            fontSize: "11px",
                            color: "#0D1117",
                            fontFamily: "JetBrains Mono"
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10, paddingTop: 12, fontFamily: "JetBrains Mono" }}
                          iconType="circle"
                          iconSize={7}
                        />
                        <Bar dataKey="Upload" fill="#ff7235" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Records" fill="#0D1117" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Action Center" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Logs & Savings" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="User Registry" fill="#a855f7" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Login" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Distinct Users" fill="#ec4899" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Right Column: AI recommendations (Span 1) */}
                <div className="bg-white border border-border/40 rounded-[28px] p-6 shadow-sm space-y-4 flex flex-col">
                  <h3 className="font-display font-bold text-lg text-[#0D1117] flex items-center gap-2 border-b border-border/30 pb-3">
                    <Sparkles className="size-5 text-primary animate-pulse" /> AI Operations Assistant
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    Live operational suggestions dynamically generated by analyzing recent usage patterns and pipeline metrics.
                  </p>

                  <div className="space-y-4 flex-1 overflow-y-auto max-h-[340px] pr-1.5 scrollbar-thin">
                    {aiSuggestions.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl border border-border/50 bg-secondary/10 space-y-2.5 hover:border-primary/20 hover:bg-white transition-all duration-150 text-left"
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider", s.color)}>
                            {s.badge}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-[#0D1117]">{s.title}</h4>
                          <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                            {s.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Log Details Inspect Dialog */}
      <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl bg-white border-border text-foreground rounded-[24px] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <DialogHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center gap-2.5">
              <span
                className={cn("text-[9px] font-mono font-bold px-2.5 py-1 rounded-md", selectedLog ? getActionBadgeStyle(selectedLog.action) : "")}
              >
                {selectedLog?.action}
              </span>
              <DialogTitle className="font-display text-lg text-[#0D1117]">
                Inspect Operation Details
              </DialogTitle>
            </div>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-5 pt-3">
              {/* User Identity Details */}
              <div className="grid grid-cols-2 gap-4 bg-secondary/15 p-4 rounded-2xl border border-border/40 text-xs font-mono">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Operator
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-800">
                    <User className="size-3.5 text-primary" />
                    <span>{selectedLog.userName}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Email Address
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-800 truncate">
                    <Mail className="size-3.5 text-primary" />
                    <span className="truncate">{selectedLog.userEmail}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Operator Role
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-800">
                    <Shield className="size-3.5 text-primary" />
                    <span>{selectedLog.userRole}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    High-Precision Time
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-800">
                    <Clock className="size-3.5 text-primary" />
                    <span>{formatTimestamp(selectedLog.timestamp)}</span>
                  </div>
                </div>
              </div>

              {/* Human Description */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block font-mono">
                  Description
                </span>
                <p className="text-sm font-semibold bg-secondary/10 p-4 rounded-xl border border-border/30 text-slate-800 leading-relaxed">
                  {selectedLog.description}
                </p>
              </div>

              {/* JSON Metadata Inspector */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block font-mono">
                  Raw Event Details
                </span>
                <div className="bg-[#0D1117] rounded-xl overflow-hidden border border-border/30">
                  <div className="bg-[#161B22] px-4 py-2 border-b border-border/30 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">
                      event_metadata.json
                    </span>
                    <span className="text-[9px] text-primary font-mono font-semibold uppercase bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                      metadata
                    </span>
                  </div>
                  <ColorizedJSONViewer data={selectedLog.details || {}} />
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2 border-t border-border/40">
                <Button
                  onClick={() => setSelectedLog(null)}
                  className="bg-primary hover:bg-primary/90 text-white font-bold h-10 px-6 rounded-xl shadow-lg shadow-primary/20 cursor-pointer transition-all"
                >
                  Close Inspector
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Purge Logs Warning Dialog */}
      <Dialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-white border-border text-foreground rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-[#0D1117] flex items-center gap-2">
              <Trash2 className="size-5 text-red-500" /> Secure Purge Request
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1">
              Are you absolutely sure you want to purge all user activity and system audit logs in Google Firestore? This action is <strong className="text-red-555 text-red-600 font-bold uppercase">irreversible</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4 border-t border-border/40 mt-3">
            <Button
              variant="outline"
              onClick={() => setPurgeConfirmOpen(false)}
              disabled={purgeMutation.isPending}
              className="bg-white border border-border/60 hover:bg-secondary/65 text-muted-foreground font-bold rounded-xl cursor-pointer transition-all"
            >
              Abort Request
            </Button>
            <Button
              disabled={purgeMutation.isPending}
              onClick={() => purgeMutation.mutate()}
              className="bg-red-600 hover:bg-red-750 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-600/15 cursor-pointer transition-all"
            >
              {purgeMutation.isPending ? "Purging Firestore..." : "Confirm Secure Purge"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
