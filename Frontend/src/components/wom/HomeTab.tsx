import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import type { Recommendation } from "@/lib/wom-data";
import { formatRecertCountdown } from "@/lib/wom-data";
import type { Summary } from "@/lib/api";
import { fetchMySettings, updateMySettings } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  Area,
  AreaChart,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Users,
  Wrench,
  TrendingUp,
  TrendingDown,
  Activity,
  Calendar,
  Filter,
  Search,
  BarChart3,
  RefreshCw,
  ArrowUpRight,
  Zap,
  ShieldAlert,
  Package,
  ChevronDown,
  X,
  MapPin,
  Settings,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HomeTabProps {
  recommendations: Recommendation[];
  summary: Summary;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  lastRefreshed: Date;
}

// ─── Color Palette ───────────────────────────────────────────────────────────

const PALETTE = {
  orange: "#e07a2e", // WOM primary
  navy: "#1e2a42", // WOM accent
  success: "#3cb97f",
  warning: "#e07a2e",
  danger: "#d94040",
  grey: "#6b7a99",
  steel: "#4a6fa5",
  teal: "#2db5a3",
  purple: "#7b5ea7",
  gold: "#c9a227",
};

const PRIORITY_COLORS: Record<string, string> = {
  High: PALETTE.danger,
  Low: PALETTE.success,
  "Manual review": PALETTE.grey,
};

const STATUS_COLORS: Record<string, string> = {
  "Expired / overdue": PALETTE.danger,
  "Due soon": PALETTE.warning,
  "Mid-cycle service opportunity": PALETTE.teal,
  "Manual review": PALETTE.grey,
};

const CONFIDENCE_COLORS: Record<string, string> = {
  High: PALETTE.success,
  Low: PALETTE.grey,
};

const SOURCE_COLORS: Record<string, string> = {
  PDF: PALETTE.orange,
  DOC: PALETTE.navy,
  DOCX: PALETTE.steel,
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 px-4 py-3 shadow-2xl backdrop-blur-md">
      {label && (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-bold text-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// Y-axis tick for horizontal bar charts with long category names (e.g. company
// names): shows more characters than the default axis width allows and adds a
// native hover tooltip (SVG <title>) revealing the full, untruncated name.
//
// Wraps a label onto up to `maxLines` lines of roughly `maxCharsPerLine`
// characters each (breaking on word boundaries), ellipsizing only the final
// line if the text still doesn't fit. This avoids the single-line
// text-anchor="end" clipping issue where long strings overflow past the left
// edge of the SVG and get cut off mid-word.
function wrapLabel(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length > maxCharsPerLine - 1 ? last.slice(0, maxCharsPerLine - 1) + "…" : last + "…";
    return kept;
  }
  return lines;
}

function LongLabelTick({
  x,
  y,
  payload,
  maxCharsPerLine = 22,
  maxLines = 2,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  maxCharsPerLine?: number;
  maxLines?: number;
}) {
  const full = String(payload?.value ?? "");
  const lines = wrapLabel(full, maxCharsPerLine, maxLines);
  const lineHeight = 11;
  const startDy = -((lines.length - 1) * lineHeight) / 2 + 4;
  return (
    <text x={x} y={y} textAnchor="end" fontSize={10} fill="var(--color-muted-foreground)">
      <title>{full}</title>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? startDy : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function PieTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0.0";
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 px-4 py-3 shadow-2xl backdrop-blur-md">
      <p className="text-sm font-bold text-foreground">{d.name}</p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {d.value} records · {pct}%
      </p>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <h2 className="font-display text-lg font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

export function MetricCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "default" | "danger" | "success" | "warning" | "primary" | "navy";
  trend?: "up" | "down" | "neutral";
}) {
  const toneMap = {
    default: { icon: "bg-foreground/5 text-foreground", value: "text-foreground" },
    primary: { icon: "bg-primary/10 text-primary", value: "text-primary" },
    danger: { icon: "bg-destructive/10 text-destructive", value: "text-destructive" },
    success: { icon: "bg-success/10 text-success", value: "text-success" },
    warning: { icon: "bg-warning/10 text-warning", value: "text-warning" },
    navy: { icon: "bg-accent/10 text-accent-foreground", value: "text-accent" },
  };
  const cls = toneMap[tone];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-background/40 p-6 shadow-sm backdrop-blur-md transition-all hover:border-primary/30 hover:bg-background/60 hover:shadow-lg hover:shadow-primary/5">
      {/* top shimmer */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110",
            cls.icon,
          )}
        >
          {icon}
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
              trend === "up"
                ? "bg-success/10 text-success"
                : trend === "down"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/50 text-muted-foreground",
            )}
          >
            {trend === "up" ? (
              <TrendingUp className="size-3" />
            ) : trend === "down" ? (
              <TrendingDown className="size-3" />
            ) : (
              <Activity className="size-3" />
            )}
          </div>
        )}
      </div>

      <div className={cn("mt-4 font-display text-4xl font-black tracking-tight", cls.value)}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
        {label}
      </div>
      {sub && <div className="mt-2 text-xs font-medium text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

// ─── Chart Card ──────────────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  children,
  className,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-background/40 p-6 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="font-display text-base font-bold tracking-tight text-foreground">
          {title}
        </div>
        {actions}
      </div>
      {subtitle && <div className="mb-4 text-xs text-muted-foreground">{subtitle}</div>}
      {children}
    </div>
  );
}

// ─── Custom Pie Label ─────────────────────────────────────────────────────────

function renderCustomPieLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      className="text-[11px] font-bold"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ─── Multi-Select Dropdown ───────────────────────────────────────────────────

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
  icon,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Position the fixed panel under the trigger button
  const openPanel = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPanelStyle({
        position: "fixed",
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 240),
        zIndex: 9999,
      });
    }
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close only when the PAGE scrolls (trigger button moves), not when panel content scrolls
  useEffect(() => {
    if (!open) return;
    const triggerEl = triggerRef.current;
    if (!triggerEl) return;
    const initialY = triggerEl.getBoundingClientRect().top;
    function handleScroll() {
      if (!triggerEl) return;
      const currentY = triggerEl.getBoundingClientRect().top;
      if (Math.abs(currentY - initialY) > 2) {
        setOpen(false);
      }
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  const filtered = search.trim()
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selected.includes(o));

  const toggleAll = () => {
    if (allFilteredSelected) {
      onChange(selected.filter((s) => !filtered.includes(s)));
    } else {
      onChange([...new Set([...selected, ...filtered])]);
    }
  };

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPanel}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-2xl border border-border/40 bg-secondary/40 pl-4 pr-10 text-sm transition-all hover:bg-secondary/60 hover:border-primary/20 focus:outline-none",
          selected.length > 0
            ? "text-foreground font-semibold"
            : "text-muted-foreground font-medium",
        )}
      >
        <span className="shrink-0 text-muted-foreground/60">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {selected.length > 0 && (
          <span className="absolute right-9 flex items-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="text-muted-foreground/60 hover:text-foreground p-1 rounded-full hover:bg-background"
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </button>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />

      {/* Dropdown panel — portalled into body so it escapes every stacking context */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl"
          >
            {/* Search */}
            <div className="border-b border-border/40 px-3 py-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search part numbers…"
                  className="h-7 w-full rounded-md border border-border/40 bg-background/50 pl-6 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                />
              </div>
            </div>

            {/* Select / deselect filtered */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[10px] font-bold text-primary hover:underline"
                >
                  {allFilteredSelected ? "Deselect all" : "Select all"}
                  {search && " matching"}
                </button>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-2.5" /> Clear ({selected.length})
                  </button>
                )}
              </div>
            )}

            {/* Options */}
            <div className="max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  No matches
                </div>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/5",
                      selected.includes(opt) ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                        selected.includes(opt)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 bg-background",
                      )}
                    >
                      {selected.includes(opt) && (
                        <svg
                          viewBox="0 0 10 8"
                          className="size-2.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="1 4 4 7 9 1" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">{opt}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

export type TimeFilter = "all" | "overdue" | "3m" | "6m" | "12m";
export type PriorityFilter = "all" | "High" | "Low" | "Manual review";

export function wildcardMatch(value: string | null | undefined, pattern: string): boolean {
  let cleanPattern = pattern.trim();
  if (
    (cleanPattern.startsWith('"') && cleanPattern.endsWith('"')) ||
    (cleanPattern.startsWith("'") && cleanPattern.endsWith("'"))
  ) {
    cleanPattern = cleanPattern.slice(1, -1).trim();
  }

  if (!cleanPattern) return true;
  if (!value) return false;

  // Standard partial match if no wildcards are used
  if (!cleanPattern.includes("*") && !cleanPattern.includes("?")) {
    return value.toLowerCase().includes(cleanPattern.toLowerCase());
  }

  // Convert wildcard pattern to RegExp
  // Escape regex special chars except * and ?
  const escaped = cleanPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  const regex = new RegExp(regexStr, "i");
  return regex.test(value);
}

function SearchInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: React.ReactNode;
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
    <div className="relative group w-full">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-colors group-focus-within:text-primary">
        {icon}
      </span>
      <input
        type="text"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl border border-border/40 bg-secondary/40 pl-11 pr-10 text-sm transition-all placeholder:text-muted-foreground/50 hover:bg-secondary/60 hover:border-primary/20 focus:bg-background focus:border-primary/50 focus:ring-1 focus:ring-primary/20 focus:outline-none text-foreground font-medium"
      />
      {localVal && (
        <button
          type="button"
          onClick={() => {
            setLocalVal("");
            onChange("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/60 hover:text-foreground hover:bg-background transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({
  timeFilter,
  setTimeFilter,
  priorityFilter,
  setPriorityFilter,
  clientSearch,
  setClientSearch,
  locationSearch,
  setLocationSearch,
  partSearch,
  setPartSearch,
  descSearch,
  setDescSearch,
  count,
  total,
  extraActions,
}: {
  timeFilter: TimeFilter;
  setTimeFilter: (v: TimeFilter) => void;
  priorityFilter: PriorityFilter;
  setPriorityFilter: (v: PriorityFilter) => void;
  clientSearch: string;
  setClientSearch: (v: string) => void;
  locationSearch: string;
  setLocationSearch: (v: string) => void;
  partSearch: string;
  setPartSearch: (v: string) => void;
  descSearch: string;
  setDescSearch: (v: string) => void;
  count: number;
  total: number;
  extraActions?: React.ReactNode;
}) {
  const timeOptions: [TimeFilter, string][] = [
    ["all", "All time"],
    ["overdue", "Overdue"],
    ["3m", "≤3 months"],
    ["6m", "≤6 months"],
    ["12m", "≤12 months"],
  ];
  const priorityOptions: [PriorityFilter, string][] = [
    ["all", "All priorities"],
    ["High", "High"],
    ["Low", "Low"],
    ["Manual review", "Manual review"],
  ];

  return (
    <div className="sticky top-20 z-30 mb-8 rounded-[2.5rem] border border-border/40 bg-white px-8 py-6 shadow-2xl shadow-black/[0.04]">
      <div className="flex flex-col gap-4">
        {/* Row 1: Quick Toggles + Count */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-9 items-center justify-center rounded-full bg-secondary/80 text-muted-foreground/60">
            <Filter className="size-4" />
          </div>

          {/* Time filter */}
          <div className="flex items-center gap-1.5">
            {timeOptions.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimeFilter(key)}
                className={cn(
                  "rounded-full px-5 py-2.5 text-xs font-bold transition-all",
                  timeFilter === key
                    ? "bg-primary text-white shadow-lg shadow-primary/25"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-8 w-px bg-border/40" />

          {/* Priority filter */}
          <div className="flex items-center gap-1.5">
            {priorityOptions.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPriorityFilter(key)}
                className={cn(
                  "rounded-full px-5 py-2.5 text-xs font-bold transition-all",
                  priorityFilter === key
                    ? "bg-accent text-white shadow-lg shadow-black/10"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Record count + Actions */}
          <div className="ml-auto flex items-center gap-5">
            <div className="flex items-center gap-2 font-display text-sm font-bold select-none">
              <span className="text-[#0D1117] font-extrabold text-base">{count}</span>
              <span className="text-muted-foreground/30 font-medium">/</span>
              <span className="text-muted-foreground/45 font-medium text-xs">{total} records</span>
            </div>
            {extraActions && (
              <div className="h-5 w-px bg-border/40" />
            )}
            {extraActions}
          </div>
        </div>

        {/* Row 2: Deep Filters */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 sm:grid-cols-2">
          <SearchInput
            value={clientSearch}
            onChange={setClientSearch}
            placeholder="Search customer…"
            icon={<Users className="size-4" />}
          />
          <SearchInput
            value={locationSearch}
            onChange={setLocationSearch}
            placeholder="Search location…"
            icon={<MapPin className="size-4" />}
          />
          <SearchInput
            value={partSearch}
            onChange={setPartSearch}
            placeholder="Search item / part…"
            icon={<Package className="size-4" />}
          />
          <SearchInput
            value={descSearch}
            onChange={setDescSearch}
            placeholder="Search item description…"
            icon={<FileText className="size-4" />}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Upcoming Recerts List ────────────────────────────────────────────────────

type UpcomingSettingsState = {
  showOverdue: boolean;
  setShowOverdue: (v: boolean) => void;
  showUpcoming: boolean;
  setShowUpcoming: (v: boolean) => void;
  overdueLimitMonths: string;
  setOverdueLimitMonths: (v: string) => void;
  upcomingLimitMonths: string;
  setUpcomingLimitMonths: (v: string) => void;
};

const UPCOMING_SETTINGS_DEFAULTS = {
  showOverdue: true,
  showUpcoming: true,
  overdueLimitMonths: "",
  upcomingLimitMonths: "",
};

// Persists the "Upcoming Recertifications" show/limit settings per signed-in
// user in Firestore (users/{uid}.upcomingSettings) so they're restored the next
// time that user logs in, on any device/deployment — not just this browser.
// localStorage is kept only as a fast local cache to avoid a flash of default
// values while the Firestore read is in flight.
function useUpcomingSettings(): UpcomingSettingsState {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const storageKey = `wom.upcomingSettings.${uid ?? "anon"}`;

  const [showOverdue, setShowOverdue] = useState(UPCOMING_SETTINGS_DEFAULTS.showOverdue);
  const [showUpcoming, setShowUpcoming] = useState(UPCOMING_SETTINGS_DEFAULTS.showUpcoming);
  const [overdueLimitMonths, setOverdueLimitMonths] = useState(
    UPCOMING_SETTINGS_DEFAULTS.overdueLimitMonths,
  );
  const [upcomingLimitMonths, setUpcomingLimitMonths] = useState(
    UPCOMING_SETTINGS_DEFAULTS.upcomingLimitMonths,
  );

  // Guards writes until the initial load (local cache + Firestore) has completed,
  // so we never overwrite saved settings with defaults while still loading.
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load: local cache first (instant), then the backend (authoritative, synced
  // across devices/deployments). Re-runs whenever the signed-in user changes.
  useEffect(() => {
    loadedRef.current = false;
    let cancelled = false;

    let cached = UPCOMING_SETTINGS_DEFAULTS;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) cached = { ...UPCOMING_SETTINGS_DEFAULTS, ...JSON.parse(raw) };
    } catch {
      // ignore malformed/unavailable storage
    }
    setShowOverdue(cached.showOverdue);
    setShowUpcoming(cached.showUpcoming);
    setOverdueLimitMonths(cached.overdueLimitMonths);
    setUpcomingLimitMonths(cached.upcomingLimitMonths);

    if (!uid) {
      loadedRef.current = true;
      return;
    }

    fetchMySettings()
      .then((remote) => {
        if (cancelled) return;
        if (remote && Object.keys(remote).length > 0) {
          const merged = { ...UPCOMING_SETTINGS_DEFAULTS, ...remote };
          setShowOverdue(merged.showOverdue);
          setShowUpcoming(merged.showUpcoming);
          setOverdueLimitMonths(merged.overdueLimitMonths);
          setUpcomingLimitMonths(merged.upcomingLimitMonths);
        }
      })
      .catch(() => {
        // ignore — local cache/defaults already applied above
      })
      .finally(() => {
        if (!cancelled) loadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [uid, storageKey]);

  // Persist on every change, once the initial load has completed.
  useEffect(() => {
    if (!loadedRef.current) return;
    const value = { showOverdue, showUpcoming, overdueLimitMonths, upcomingLimitMonths };
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore quota/availability errors
    }
    if (uid) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateMySettings(value).catch(() => {
          // ignore — local cache still has the latest value; will retry on next change
        });
      }, 600);
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [storageKey, uid, showOverdue, showUpcoming, overdueLimitMonths, upcomingLimitMonths]);

  return {
    showOverdue,
    setShowOverdue,
    showUpcoming,
    setShowUpcoming,
    overdueLimitMonths,
    setOverdueLimitMonths,
    upcomingLimitMonths,
    setUpcomingLimitMonths,
  };
}

function LimitPicker({
  idPrefix,
  disabled,
  value,
  onChange,
}: {
  idPrefix: string;
  disabled?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const presets = ["", "1", "2", "3", "6", "12"];
  return (
    <div className={cn("space-y-2.5", disabled && "pointer-events-none opacity-40")}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p || "none"}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
              value === p
                ? "border-orange-500 bg-orange-500 text-white"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-foreground/[0.06]",
            )}
          >
            {p === "" ? "No limit" : p}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-custom`} className="text-[11px] text-muted-foreground">
          Custom months
        </Label>
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(String(Math.max(0, (Number(value) || 0) - 1)))}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <Minus className="size-3.5" />
          </button>
          <Input
            id={`${idPrefix}-custom`}
            type="number"
            min={0}
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            className="h-8 text-center text-xs"
          />
          <button
            type="button"
            onClick={() => onChange(String((Number(value) || 0) + 1))}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function UpcomingSettingsPopover(props: UpcomingSettingsState) {
  const {
    showOverdue,
    setShowOverdue,
    showUpcoming,
    setShowUpcoming,
    overdueLimitMonths,
    setOverdueLimitMonths,
    upcomingLimitMonths,
    setUpcomingLimitMonths,
  } = props;
  const [open, setOpen] = useState(false);

  function handleReset() {
    setShowOverdue(UPCOMING_SETTINGS_DEFAULTS.showOverdue);
    setShowUpcoming(UPCOMING_SETTINGS_DEFAULTS.showUpcoming);
    setOverdueLimitMonths(UPCOMING_SETTINGS_DEFAULTS.overdueLimitMonths);
    setUpcomingLimitMonths(UPCOMING_SETTINGS_DEFAULTS.upcomingLimitMonths);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Upcoming recertifications settings"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <Settings className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">Upcoming recertifications settings</span>
          <Settings className="size-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="upcoming-show-overdue" className="text-xs font-semibold">
              Show overdue
            </Label>
            <Switch
              id="upcoming-show-overdue"
              checked={showOverdue}
              onCheckedChange={setShowOverdue}
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Overdue limit (months)</Label>
            <div className="mt-1.5">
              <LimitPicker
                idPrefix="overdue-limit"
                disabled={!showOverdue}
                value={overdueLimitMonths}
                onChange={setOverdueLimitMonths}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2.5 border-t border-border/40 pt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="upcoming-show-upcoming" className="text-xs font-semibold">
              Show upcoming
            </Label>
            <Switch
              id="upcoming-show-upcoming"
              checked={showUpcoming}
              onCheckedChange={setShowUpcoming}
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Upcoming limit (months)</Label>
            <div className="mt-1.5">
              <LimitPicker
                idPrefix="upcoming-limit"
                disabled={!showUpcoming}
                value={upcomingLimitMonths}
                onChange={setUpcomingLimitMonths}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleReset}>
            Reset
          </Button>
          <Button
            size="sm"
            className="h-8 bg-orange-500 text-xs text-white hover:bg-orange-600"
            onClick={() => setOpen(false)}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}


function UpcomingRow({ rec }: { rec: Recommendation }) {
  const navigate = useNavigate();
  const overdue =
    rec.monthsToRecert !== null &&
    (rec.monthsToRecert < 0 || (rec.monthsToRecert === 0 && (rec.daysToRecert ?? 0) < 0));
  const dueSoon =
    !overdue && rec.monthsToRecert !== null && rec.monthsToRecert <= 6 && rec.monthsToRecert >= 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate({ to: "/records", search: { recId: rec.id } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate({ to: "/records", search: { recId: rec.id } });
        }
      }}
      className="flex cursor-pointer items-center gap-4 rounded-xl px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
          overdue
            ? "bg-destructive/10 text-destructive"
            : dueSoon
              ? "bg-warning/10 text-warning"
              : "bg-success/10 text-success",
        )}
      >
        {overdue ? <ShieldAlert className="size-4" /> : <Calendar className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {rec.customer ?? <span className="italic text-muted-foreground">Unknown customer</span>}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {rec.equipment ?? "—"} · {rec.salesOrder ?? "No SO"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn(
            "font-mono text-sm font-bold",
            overdue ? "text-destructive" : dueSoon ? "text-warning" : "text-success",
          )}
        >
          {rec.recertificationDue ?? "—"}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {formatRecertCountdown(rec)}
        </div>
      </div>
    </div>
  );
}

// ─── Charts Section (reusable, driven by any filtered array) ─────────────────

export function ChartsSection({ filtered }: { filtered: Recommendation[] }) {
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) counts[r.priority] = (counts[r.priority] ?? 0) + 1;
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      const key = r.status || "Unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) counts[r.sourceType] = (counts[r.sourceType] ?? 0) + 1;
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const confidenceData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) counts[r.confidence] = (counts[r.confidence] ?? 0) + 1;
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const timelineData = useMemo(() => {
    const buckets = [
      { label: "Overdue", min: -Infinity as number, max: -1 as number },
      { label: "0–3 mo", min: 0, max: 3 },
      { label: "3–6 mo", min: 3, max: 6 },
      { label: "6–12 mo", min: 6, max: 12 },
      { label: "12–24 mo", min: 12, max: 24 },
      { label: "24+ mo", min: 24, max: Infinity as number },
      { label: "Unknown", min: null as null, max: null as null },
    ];
    return buckets.map(({ label, min, max }) => ({
      label,
      count: filtered.filter((r) => {
        if (min === null) return r.monthsToRecert === null;
        if (r.monthsToRecert === null) return false;
        return r.monthsToRecert >= min && r.monthsToRecert < max!;
      }).length,
    }));
  }, [filtered]);

  const customerData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) if (r.customer) counts[r.customer] = (counts[r.customer] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [filtered]);

  const equipmentData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) if (r.equipment) counts[r.equipment] = (counts[r.equipment] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 22 ? name.slice(0, 20) + "…" : name, count }));
  }, [filtered]);

  const {
    showOverdue,
    setShowOverdue,
    showUpcoming,
    setShowUpcoming,
    overdueLimitMonths,
    setOverdueLimitMonths,
    upcomingLimitMonths,
    setUpcomingLimitMonths,
  } = useUpcomingSettings();
  const upcomingAll = useMemo(() => {
    const overdueLimit = overdueLimitMonths.trim() === "" ? null : Number(overdueLimitMonths);
    const upcomingLimit = upcomingLimitMonths.trim() === "" ? null : Number(upcomingLimitMonths);
    return [...filtered]
      .filter((r) => r.monthsToRecert !== null)
      .filter((r) => {
        const m = r.monthsToRecert as number;
        if (m < 0) {
          if (!showOverdue) return false;
          if (overdueLimit !== null && Math.abs(m) > overdueLimit) return false;
          return true;
        }
        if (!showUpcoming) return false;
        if (upcomingLimit !== null && m > upcomingLimit) return false;
        return true;
      })
      .sort((a, b) => {
        const da = a.daysToRecert ?? (a.monthsToRecert ?? 999) * 30;
        const db = b.daysToRecert ?? (b.monthsToRecert ?? 999) * 30;
        return da - db;
      });
  }, [filtered, showOverdue, showUpcoming, overdueLimitMonths, upcomingLimitMonths]);
  const upcoming = upcomingAll.slice(0, 5);
  const [upcomingDialogOpen, setUpcomingDialogOpen] = useState(false);

  function timelineBarColor(label: string) {
    if (label === "Overdue") return PALETTE.danger;
    if (label === "0–3 mo") return PALETTE.warning;
    if (label === "3–6 mo") return PALETTE.gold;
    if (label === "6–12 mo") return PALETTE.teal;
    if (label === "12–24 mo") return PALETTE.success;
    return PALETTE.grey;
  }

  return (
    <div>
      {/* Row 1 — three donuts */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard title="Priority Breakdown" subtitle="Filtered records by priority level">
          {priorityData.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={priorityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    labelLine={false}
                    label={renderCustomPieLabel}
                  >
                    {priorityData.map((e) => (
                      <Cell key={e.name} fill={PRIORITY_COLORS[e.name] ?? PALETTE.grey} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<PieTooltip total={priorityData.reduce((s, d) => s + d.value, 0)} />}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {priorityData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: PRIORITY_COLORS[d.name] ?? PALETTE.grey }}
                    />
                    {d.name}: <span className="font-bold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard title="Status Distribution" subtitle="Lifecycle status across filtered records">
          {statusData.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    labelLine={false}
                    label={renderCustomPieLabel}
                  >
                    {statusData.map((e) => (
                      <Cell key={e.name} fill={STATUS_COLORS[e.name] ?? PALETTE.grey} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<PieTooltip total={statusData.reduce((s, d) => s + d.value, 0)} />}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {statusData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[d.name] ?? PALETTE.grey }}
                    />
                    <span className="max-w-[120px] truncate">{d.name}:</span>
                    <span className="font-bold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Extraction Confidence"
          subtitle="AI confidence level across filtered records"
        >
          {confidenceData.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={confidenceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    labelLine={false}
                    label={renderCustomPieLabel}
                  >
                    {confidenceData.map((e) => (
                      <Cell key={e.name} fill={CONFIDENCE_COLORS[e.name] ?? PALETTE.grey} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<PieTooltip total={confidenceData.reduce((s, d) => s + d.value, 0)} />}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {confidenceData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: CONFIDENCE_COLORS[d.name] ?? PALETTE.grey }}
                    />
                    {d.name}: <span className="font-bold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Row 2 — timeline + top customers */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Recertification Timeline"
          subtitle="How far out is each certificate from recertification?"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={timelineData}
              barSize={32}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Records" radius={[6, 6, 0, 0]}>
                {timelineData.map((e) => (
                  <Cell key={e.label} fill={timelineBarColor(e.label)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap gap-3">
            {[
              { label: "Overdue", color: PALETTE.danger },
              { label: "0–3 mo", color: PALETTE.warning },
              { label: "3–6 mo", color: PALETTE.gold },
              { label: "6–12 mo", color: PALETTE.teal },
              { label: "12–24 mo", color: PALETTE.success },
              { label: "24+ mo", color: PALETTE.grey },
            ].map(({ label, color }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
                {label}
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Top Customers by Records"
          subtitle="Customers with the most ingested certificates"
        >
          {customerData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No customer data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={customerData}
                layout="vertical"
                barSize={18}
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={190}
                  tick={<LongLabelTick maxCharsPerLine={22} maxLines={2} />}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Records" fill={PALETTE.navy} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3 — top equipment + upcoming recerts */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Top Equipment Types" subtitle="Most frequently appearing equipment">
          {equipmentData.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
              No equipment data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={equipmentData}
                layout="vertical"
                barSize={18}
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Records" fill={PALETTE.orange} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Upcoming Recertifications"
          subtitle={`Next ${upcoming.length} of ${upcomingAll.length} records sorted by urgency`}
          actions={
            <UpcomingSettingsPopover
              showOverdue={showOverdue}
              setShowOverdue={setShowOverdue}
              showUpcoming={showUpcoming}
              setShowUpcoming={setShowUpcoming}
              overdueLimitMonths={overdueLimitMonths}
              setOverdueLimitMonths={setOverdueLimitMonths}
              upcomingLimitMonths={upcomingLimitMonths}
              setUpcomingLimitMonths={setUpcomingLimitMonths}
            />
          }
        >
          {upcoming.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
              No upcoming recertifications
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/30 overflow-hidden rounded-xl border border-border/40">
                {upcoming.map((r) => (
                  <UpcomingRow key={r.id} rec={r} />
                ))}
              </div>
              {upcomingAll.length > upcoming.length && (
                <button
                  type="button"
                  onClick={() => setUpcomingDialogOpen(true)}
                  className="mt-3 w-full rounded-lg border border-border/40 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/5"
                >
                  See all {upcomingAll.length} →
                </button>
              )}
            </>
          )}
        </ChartCard>
      </div>

      <Dialog open={upcomingDialogOpen} onOpenChange={setUpcomingDialogOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>All Upcoming Recertifications</DialogTitle>
            <DialogDescription>{upcomingAll.length} records sorted by urgency</DialogDescription>
          </DialogHeader>
          <div className="flex-1 divide-y divide-border/30 overflow-y-auto rounded-xl border border-border/40">
            {upcomingAll.map((r) => (
              <UpcomingRow key={r.id} rec={r} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main HomeTab ─────────────────────────────────────────────────────────────

export function HomeTab({
  recommendations,
  summary,
  isLoading,
  isError,
  onRefresh,
  lastRefreshed,
}: HomeTabProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [clientSearch, setClientSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [descSearch, setDescSearch] = useState("");

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      // Time filter
      if (timeFilter === "overdue") {
        if (r.monthsToRecert === null || r.monthsToRecert >= 0) return false;
      } else if (timeFilter === "3m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 3 || r.monthsToRecert < 0) return false;
      } else if (timeFilter === "6m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 6 || r.monthsToRecert < 0) return false;
      } else if (timeFilter === "12m") {
        if (r.monthsToRecert === null || r.monthsToRecert > 12 || r.monthsToRecert < 0)
          return false;
      }

      // Priority filter
      if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;

      // Free-text wildcard search criteria
      if (clientSearch && !wildcardMatch(r.customer, clientSearch)) return false;
      if (locationSearch && !wildcardMatch(r.location, locationSearch)) return false;
      if (partSearch && !r.partNumbers.some((p) => wildcardMatch(p.number, partSearch))) return false;
      if (descSearch && !(
        wildcardMatch(r.equipment, descSearch) || 
        r.partNumbers.some((p) => wildcardMatch(p.description, descSearch))
      )) return false;

      return true;
    });
  }, [
    recommendations,
    timeFilter,
    priorityFilter,
    clientSearch,
    locationSearch,
    partSearch,
    descSearch,
  ]);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const recs = filtered;
    const total = recs.length;
    const high = recs.filter((r) => r.priority === "High").length;
    const overdue = recs.filter((r) => r.status === "Expired / overdue").length;
    const dueSoon = recs.filter(
      (r) => r.monthsToRecert !== null && r.monthsToRecert >= 0 && r.monthsToRecert <= 6,
    ).length;
    const customers = new Set(recs.map((r) => r.customer).filter(Boolean)).size;
    const equipment = new Set(recs.map((r) => r.equipment).filter(Boolean)).size;
    const avgAge =
      recs.filter((r) => r.ageMonths !== null).length > 0
        ? Math.round(
            recs.filter((r) => r.ageMonths !== null).reduce((a, r) => a + (r.ageMonths ?? 0), 0) /
              recs.filter((r) => r.ageMonths !== null).length,
          )
        : null;
    const parts = recs.reduce((a, r) => a + r.partNumbers.length, 0);
    const highConf = recs.filter((r) => r.confidence === "High").length;
    const extractionRate = total > 0 ? Math.round((highConf / total) * 100) : 0;

    return { total, high, overdue, dueSoon, customers, equipment, avgAge, parts, extractionRate };
  }, [filtered]);

  // ── Priority chart data ────────────────────────────────────────────────────
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      counts[r.priority] = (counts[r.priority] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Status chart data ──────────────────────────────────────────────────────
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      const key = r.status || "Unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Source type data ───────────────────────────────────────────────────────
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      counts[r.sourceType] = (counts[r.sourceType] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  // ── Confidence chart data ──────────────────────────────────────────────────
  const confidenceData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      counts[r.confidence] = (counts[r.confidence] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Recertification timeline bar chart ────────────────────────────────────
  const timelineData = useMemo(() => {
    const buckets = [
      { label: "Overdue", min: -Infinity, max: -1 },
      { label: "0–3 mo", min: 0, max: 3 },
      { label: "3–6 mo", min: 3, max: 6 },
      { label: "6–12 mo", min: 6, max: 12 },
      { label: "12–24 mo", min: 12, max: 24 },
      { label: "24+ mo", min: 24, max: Infinity },
      { label: "Unknown", min: null, max: null },
    ];
    return buckets.map(({ label, min, max }) => ({
      label,
      count: filtered.filter((r) => {
        if (min === null) return r.monthsToRecert === null;
        if (r.monthsToRecert === null) return false;
        return r.monthsToRecert >= (min as number) && r.monthsToRecert < (max as number);
      }).length,
    }));
  }, [filtered]);

  // ── Top customers bar chart ────────────────────────────────────────────────
  const customerData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      if (r.customer) counts[r.customer] = (counts[r.customer] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [filtered]);

  // ── Top equipment bar chart ────────────────────────────────────────────────
  const equipmentData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      if (r.equipment) counts[r.equipment] = (counts[r.equipment] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 22 ? name.slice(0, 20) + "…" : name, count }));
  }, [filtered]);

  // ── Upcoming recertifications ──────────────────────────────────────────────
  const {
    showOverdue,
    setShowOverdue,
    showUpcoming,
    setShowUpcoming,
    overdueLimitMonths,
    setOverdueLimitMonths,
    upcomingLimitMonths,
    setUpcomingLimitMonths,
  } = useUpcomingSettings();
  const upcomingAll = useMemo(() => {
    const overdueLimit = overdueLimitMonths.trim() === "" ? null : Number(overdueLimitMonths);
    const upcomingLimit = upcomingLimitMonths.trim() === "" ? null : Number(upcomingLimitMonths);
    return [...filtered]
      .filter((r) => r.monthsToRecert !== null)
      .filter((r) => {
        const m = r.monthsToRecert as number;
        if (m < 0) {
          if (!showOverdue) return false;
          if (overdueLimit !== null && Math.abs(m) > overdueLimit) return false;
          return true;
        }
        if (!showUpcoming) return false;
        if (upcomingLimit !== null && m > upcomingLimit) return false;
        return true;
      })
      .sort((a, b) => {
        const da = a.daysToRecert ?? (a.monthsToRecert ?? 999) * 30;
        const db = b.daysToRecert ?? (b.monthsToRecert ?? 999) * 30;
        return da - db;
      });
  }, [filtered, showOverdue, showUpcoming, overdueLimitMonths, upcomingLimitMonths]);
  const upcoming = upcomingAll.slice(0, 5);
  const [upcomingDialogOpen, setUpcomingDialogOpen] = useState(false);

  // ── Bar chart bar color helper ─────────────────────────────────────────────
  function timelineBarColor(label: string) {
    if (label === "Overdue") return PALETTE.danger;
    if (label === "0–3 mo") return PALETTE.warning;
    if (label === "3–6 mo") return PALETTE.gold;
    if (label === "6–12 mo") return PALETTE.teal;
    if (label === "12–24 mo") return PALETTE.success;
    return PALETTE.grey;
  }

  const noData = !isLoading && !isError && recommendations.length === 0;
  const isEmpty = !isLoading && !isError && filtered.length === 0 && recommendations.length > 0;

  // Records that need human review and haven't been reviewed yet
  const needsHumanReview = recommendations.filter(
    (r) => r.priority === "Manual review" && !r.humanReviewed,
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            Live Overview · Cloud Platform
          </div>
          <h1 className="mt-4 font-display text-4xl font-black tracking-tight text-accent">
            Operations <span className="text-primary italic">Dashboard</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Real-time equipment lifecycle intelligence across all ingested certificates of
            conformance.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="gap-2 border-border/50 bg-background/40"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <div className="font-mono text-[10px] text-muted-foreground/60">
            Updated {lastRefreshed.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* ── Loading skeleton ─────────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-foreground/[0.04]" />
          ))}
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {isError && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-8 text-destructive/70" />
          </div>
          <p className="text-base font-semibold text-foreground">Could not load data</p>
          <p className="text-sm text-muted-foreground">Ensure the FastAPI backend is running.</p>
        </div>
      )}

      {/* ── No data state ────────────────────────────────────────────────── */}
      {noData && (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-foreground/[0.03]">
            <BarChart3 className="size-8 text-muted-foreground/50" />
          </div>
          <p className="text-base font-semibold text-foreground">No data yet</p>
          <p className="text-sm text-muted-foreground">
            Ingest PDF / DOC / DOCX certificates of conformance to populate the dashboard.
          </p>
        </div>
      )}

      {!isLoading && !isError && needsHumanReview.length > 0 && (
        <div className="mb-8 rounded-2xl border border-amber-400/40 bg-amber-50/80 p-5 shadow-sm ring-1 ring-amber-400/20 backdrop-blur-sm">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-600">
              <AlertTriangle className="size-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900 leading-snug">
                Human review is needed
              </p>
              <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                {needsHumanReview.length === 1
                  ? "1 certificate could not be fully extracted by AI and requires manual inspection before it can be trusted."
                  : `${needsHumanReview.length} certificates could not be fully extracted by AI and require manual inspection before they can be trusted.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {needsHumanReview.slice(0, 5).map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-100 px-3 py-1 font-mono text-[10px] font-bold text-amber-800"
                  >
                    <AlertTriangle className="size-2.5 shrink-0" />
                    {r.sourceFile}
                  </span>
                ))}
                {needsHumanReview.length > 5 && (
                  <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-100/60 px-3 py-1 font-mono text-[10px] font-bold text-amber-700">
                    +{needsHumanReview.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && !isError && recommendations.length > 0 && (
        <>
          {/* ── Filter bar ──────────────────────────────────────────────── */}
          <FilterBar
            timeFilter={timeFilter}
            setTimeFilter={setTimeFilter}
            priorityFilter={priorityFilter}
            setPriorityFilter={setPriorityFilter}
            clientSearch={clientSearch}
            setClientSearch={setClientSearch}
            locationSearch={locationSearch}
            setLocationSearch={setLocationSearch}
            partSearch={partSearch}
            setPartSearch={setPartSearch}
            descSearch={descSearch}
            setDescSearch={setDescSearch}
            count={filtered.length}
            total={recommendations.length}
          />

          {/* ── KPI Grid ────────────────────────────────────────────────── */}
          <div className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={<FileText className="size-5" />}
              label="Total Records"
              value={isLoading ? "—" : metrics.total}
              sub={`${summary.filesProcessed} files processed`}
              tone="default"
            />
            <MetricCard
              icon={<ShieldAlert className="size-5" />}
              label="High Priority"
              value={isLoading ? "—" : metrics.high}
              sub={
                metrics.total > 0
                  ? `${Math.round((metrics.high / metrics.total) * 100)}% of total`
                  : "No records"
              }
              tone="danger"
              trend={metrics.high > 0 ? "up" : "neutral"}
            />
            <MetricCard
              icon={<AlertTriangle className="size-5" />}
              label="Overdue"
              value={isLoading ? "—" : metrics.overdue}
              sub="Recertification expired"
              tone="danger"
              trend={metrics.overdue > 0 ? "up" : "neutral"}
            />
            <MetricCard
              icon={<Clock className="size-5" />}
              label="Due ≤6 Months"
              value={isLoading ? "—" : metrics.dueSoon}
              sub="Upcoming recertification"
              tone="warning"
              trend={metrics.dueSoon > 0 ? "up" : "neutral"}
            />
            <MetricCard
              icon={<Users className="size-5" />}
              label="Active Customers"
              value={isLoading ? "—" : metrics.customers}
              sub="Unique customers on file"
              tone="navy"
            />
            <MetricCard
              icon={<Wrench className="size-5" />}
              label="Equipment Types"
              value={isLoading ? "—" : metrics.equipment}
              sub="Distinct equipment entries"
              tone="primary"
            />
            <MetricCard
              icon={<Package className="size-5" />}
              label="Part Numbers"
              value={isLoading ? "—" : metrics.parts}
              sub="Across all certificates"
              tone="default"
            />
            <MetricCard
              icon={<Zap className="size-5" />}
              label="Extraction Accuracy"
              value={isLoading ? "—" : `${metrics.extractionRate}%`}
              sub={`${metrics.total - metrics.high} high-confidence records`}
              tone="success"
              trend={metrics.extractionRate >= 80 ? "up" : "down"}
            />
          </div>

          {/* ── Charts Row 1 ────────────────────────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Priority Donut */}
            <ChartCard title="Priority Breakdown" subtitle="Filtered records by priority level">
              {priorityData.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                  No data
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={priorityData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        labelLine={false}
                        label={renderCustomPieLabel}
                      >
                        {priorityData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={PRIORITY_COLORS[entry.name] ?? PALETTE.grey}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <PieTooltip total={priorityData.reduce((s, d) => s + d.value, 0)} />
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    {priorityData.map((d) => (
                      <div
                        key={d.name}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: PRIORITY_COLORS[d.name] ?? PALETTE.grey }}
                        />
                        {d.name}: <span className="font-bold text-foreground">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>

            {/* Status Donut */}
            <ChartCard
              title="Status Distribution"
              subtitle="Lifecycle status across filtered records"
            >
              {statusData.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                  No data
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        labelLine={false}
                        label={renderCustomPieLabel}
                      >
                        {statusData.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? PALETTE.grey} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={<PieTooltip total={statusData.reduce((s, d) => s + d.value, 0)} />}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    {statusData.map((d) => (
                      <div
                        key={d.name}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: STATUS_COLORS[d.name] ?? PALETTE.grey }}
                        />
                        <span className="max-w-[120px] truncate">{d.name}:</span>
                        <span className="font-bold text-foreground">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>

            {/* Confidence Donut */}
            <ChartCard
              title="Extraction Confidence"
              subtitle="AI confidence level across filtered records"
            >
              {confidenceData.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                  No data
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={confidenceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        labelLine={false}
                        label={renderCustomPieLabel}
                      >
                        {confidenceData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={CONFIDENCE_COLORS[entry.name] ?? PALETTE.grey}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <PieTooltip total={confidenceData.reduce((s, d) => s + d.value, 0)} />
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    {confidenceData.map((d) => (
                      <div
                        key={d.name}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: CONFIDENCE_COLORS[d.name] ?? PALETTE.grey }}
                        />
                        {d.name}: <span className="font-bold text-foreground">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>
          </div>

          {/* ── Charts Row 2 ────────────────────────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Recertification Timeline */}
            <ChartCard
              title="Recertification Timeline"
              subtitle="How far out is each certificate from recertification?"
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={timelineData}
                  barSize={32}
                  margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Records" radius={[6, 6, 0, 0]}>
                    {timelineData.map((entry) => (
                      <Cell key={entry.label} fill={timelineBarColor(entry.label)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Color legend */}
              <div className="mt-3 flex flex-wrap gap-3">
                {[
                  { label: "Overdue", color: PALETTE.danger },
                  { label: "0–3 mo", color: PALETTE.warning },
                  { label: "3–6 mo", color: PALETTE.gold },
                  { label: "6–12 mo", color: PALETTE.teal },
                  { label: "12–24 mo", color: PALETTE.success },
                  { label: "24+ mo", color: PALETTE.grey },
                ].map(({ label, color }) => (
                  <div
                    key={label}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                  >
                    <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
                    {label}
                  </div>
                ))}
              </div>
            </ChartCard>

            {/* Top Customers */}
            <ChartCard
              title="Top Customers by Records"
              subtitle="Customers with the most ingested certificates"
            >
              {customerData.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  No customer data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={customerData}
                    layout="vertical"
                    barSize={18}
                    margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(0,0,0,0.06)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={190}
                      tick={<LongLabelTick maxCharsPerLine={22} maxLines={2} />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Records" fill={PALETTE.navy} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* ── Charts Row 3 ────────────────────────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top Equipment */}
            <ChartCard title="Top Equipment Types" subtitle="Most frequently appearing equipment">
              {equipmentData.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  No equipment data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={equipmentData}
                    layout="vertical"
                    barSize={18}
                    margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(0,0,0,0.06)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="count"
                      name="Records"
                      fill={PALETTE.orange}
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Upcoming Recertifications */}
            <ChartCard
              title="Upcoming Recertifications"
              subtitle={`Next ${upcoming.length} of ${upcomingAll.length} records sorted by urgency`}
              actions={
                <UpcomingSettingsPopover
                  showOverdue={showOverdue}
                  setShowOverdue={setShowOverdue}
                  showUpcoming={showUpcoming}
                  setShowUpcoming={setShowUpcoming}
                  overdueLimitMonths={overdueLimitMonths}
                  setOverdueLimitMonths={setOverdueLimitMonths}
                  upcomingLimitMonths={upcomingLimitMonths}
                  setUpcomingLimitMonths={setUpcomingLimitMonths}
                />
              }
            >
              {upcoming.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  {isEmpty ? "No results match current filters" : "No upcoming recertifications"}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border/30 overflow-hidden rounded-xl border border-border/40">
                    {upcoming.map((r) => (
                      <UpcomingRow key={r.id} rec={r} />
                    ))}
                  </div>
                  {upcomingAll.length > upcoming.length && (
                    <button
                      type="button"
                      onClick={() => setUpcomingDialogOpen(true)}
                      className="mt-3 w-full rounded-lg border border-border/40 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/5"
                    >
                      See all {upcomingAll.length} →
                    </button>
                  )}
                </>
              )}
            </ChartCard>
          </div>

          <Dialog open={upcomingDialogOpen} onOpenChange={setUpcomingDialogOpen}>
            <DialogContent className="flex max-h-[80vh] max-w-xl flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle>All Upcoming Recertifications</DialogTitle>
                <DialogDescription>
                  {upcomingAll.length} records sorted by urgency
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 divide-y divide-border/30 overflow-y-auto rounded-xl border border-border/40">
                {upcomingAll.map((r) => (
                  <UpcomingRow key={r.id} rec={r} />
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Summary strip ───────────────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/30 bg-foreground/[0.015] px-6 py-4 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                Showing <span className="font-bold text-foreground">{metrics.total}</span> of{" "}
                <span className="font-bold text-foreground">{recommendations.length}</span> records
              </div>
              <div className="size-1 rounded-full bg-border" />
              <div>
                Lifecycle rule:{" "}
                <span className="font-mono font-bold text-primary">60-month recertification</span>
              </div>
              <div className="size-1 rounded-full bg-border" />
              <div className="font-mono text-[10px] uppercase tracking-wider">
                As of {summary.asOf}
              </div>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-50">
              WOM_Lifecycle · v1.0.0
            </div>
          </div>
        </>
      )}
    </div>
  );
}
