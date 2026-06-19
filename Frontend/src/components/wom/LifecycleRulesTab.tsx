import {
  ShieldCheck,
  Clock,
  TrendingUp,
  CheckCircle2,
  FileText,
  Info,
  Calendar,
} from "lucide-react";

interface Rule {
  id: string;
  title: string;
  description: string;
  value: string;
  note?: string;
  tone: "primary" | "success" | "warning" | "destructive" | "default";
}

const RECERT_RULES: Rule[] = [
  {
    id: "standard-cycle",
    title: "Standard Recertification Cycle",
    description:
      "All WOM oilfield equipment must be recertified every 60 months (5 years) from the original certificate date. This applies to choke valves, gate valves, manifolds, and associated pressure-control equipment.",
    value: "60 months",
    note: "Per API 6A / API 16C / NACE MR0175 guidelines",
    tone: "primary",
  },
  {
    id: "high-priority-threshold",
    title: "High-Priority Escalation Threshold",
    description:
      "Any equipment with fewer than 6 months remaining until recertification, or already past the recertification date, is automatically escalated to High priority and flagged for immediate customer outreach.",
    value: "≤ 6 months",
    note: "Triggers immediate outreach workflow",
    tone: "destructive",
  },
  {
    id: "due-soon",
    title: "Due-Soon Warning Window",
    description:
      "Equipment with between 6 and 18 months remaining until recertification is marked as a mid-cycle service opportunity. This window allows proactive scheduling before a high-priority escalation occurs.",
    value: "6 – 18 months",
    note: "Proactive scheduling opportunity",
    tone: "warning",
  },
  {
    id: "acceptable-window",
    title: "Acceptable Service Window",
    description:
      "Equipment with more than 18 months remaining is considered within the acceptable service lifecycle. No immediate outreach is required, but records are retained for portfolio visibility.",
    value: "> 18 months",
    note: "Low priority — monitor only",
    tone: "success",
  },
];

const PRIORITY_RULES: Rule[] = [
  {
    id: "overdue",
    title: "Expired / Overdue",
    description:
      "Certificate date + 60 months is before today's date. Customer must be contacted immediately.",
    value: "Immediate",
    tone: "destructive",
  },
  {
    id: "due-soon-priority",
    title: "Due Soon",
    description:
      "0–6 months until the 60-month threshold. High-priority flag is raised. A quote or recertification order should be initiated.",
    value: "High",
    tone: "warning",
  },
  {
    id: "mid-cycle",
    title: "Mid-Cycle Opportunity",
    description:
      "6–18 months until recertification. Flag as a service opportunity. Use to fill upcoming capacity or bundle with other customer orders.",
    value: "Low",
    tone: "primary",
  },
  {
    id: "ok",
    title: "Within Lifecycle",
    description:
      "More than 18 months remaining. No action required. Record is archived for visibility.",
    value: "Monitor",
    tone: "success",
  },
];

const ACCEPTED_FORMATS = [
  { ext: "PDF", description: "Native or scanned PDF certificates", supported: true },
  { ext: "DOC", description: "Microsoft Word 97–2003 documents", supported: true },
  { ext: "DOCX", description: "Microsoft Word Open XML documents", supported: true },
];

export function LifecycleRulesTab() {
  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Page Header */}
      <section className="relative py-12 overflow-hidden">
        <div className="mx-auto max-w-[1600px] px-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-6">
              <ShieldCheck className="size-3" />
              Lifecycle Configuration
            </div>
            <h1 className="font-display text-4xl font-black tracking-tight text-accent md:text-5xl">
              Lifecycle <span className="text-primary italic">Rules</span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground/90 leading-relaxed">
              Business rules that govern equipment recertification scheduling, priority escalation
              thresholds, and the AI processing pipeline.
            </p>
          </div>
        </div>
      </section>

      <div className="flex-1 mx-auto w-full max-w-[1600px] px-6 pb-12 space-y-10">
        {/* Recertification Rules */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="size-8 rounded-lg bg-primary/10 grid place-items-center">
              <Clock className="size-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                Recertification Standards
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Industry-mandated service intervals applied to all ingested CoCs
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {RECERT_RULES.map((rule) => {
              const borderCls =
                rule.tone === "primary"
                  ? "border-primary/30"
                  : rule.tone === "destructive"
                    ? "border-destructive/30"
                    : rule.tone === "warning"
                      ? "border-warning/30"
                      : rule.tone === "success"
                        ? "border-success/30"
                        : "border-border/50";
              const valueCls =
                rule.tone === "primary"
                  ? "text-primary bg-primary/10"
                  : rule.tone === "destructive"
                    ? "text-destructive bg-destructive/10"
                    : rule.tone === "warning"
                      ? "text-warning bg-warning/10"
                      : rule.tone === "success"
                        ? "text-success bg-success/10"
                        : "text-foreground bg-foreground/5";
              return (
                <div
                  key={rule.id}
                  className={`rounded-2xl border ${borderCls} bg-background/30 backdrop-blur-md p-6`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="font-display text-base font-bold text-foreground leading-tight">
                      {rule.title}
                    </h3>
                    <span
                      className={`shrink-0 rounded-xl px-3 py-1.5 font-mono text-sm font-black ${valueCls}`}
                    >
                      {rule.value}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {rule.description}
                  </p>
                  {rule.note && (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/70 font-mono">
                      <Info className="size-3" />
                      {rule.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority Matrix */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="size-8 rounded-lg bg-warning/10 grid place-items-center">
              <TrendingUp className="size-4 text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                Priority Escalation Matrix
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                How records are classified based on remaining lifecycle time
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/20 backdrop-blur-md shadow-xl">
            <div className="grid grid-cols-[140px_1fr_100px] gap-4 border-b border-border/50 bg-foreground/[0.02] px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              <div>Status Label</div>
              <div>Condition &amp; Recommended Action</div>
              <div>Priority</div>
            </div>
            <div className="divide-y divide-border/30">
              {PRIORITY_RULES.map((rule) => {
                const statusBorder =
                  rule.tone === "destructive"
                    ? "border-l-destructive"
                    : rule.tone === "warning"
                      ? "border-l-warning"
                      : rule.tone === "primary"
                        ? "border-l-primary"
                        : "border-l-success";
                const badgeCls =
                  rule.tone === "destructive"
                    ? "bg-destructive/15 text-destructive border-destructive/30"
                    : rule.tone === "warning"
                      ? "bg-warning/15 text-warning border-warning/40"
                      : rule.tone === "primary"
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-success/10 text-success border-success/30";
                const priorityCls =
                  rule.value === "Immediate"
                    ? "text-destructive font-black"
                    : rule.value === "High"
                      ? "text-warning font-bold"
                      : rule.value === "Low"
                        ? "text-primary font-bold"
                        : "text-muted-foreground font-medium";
                return (
                  <div
                    key={rule.id}
                    className={`grid grid-cols-[140px_1fr_100px] gap-4 px-6 py-5 border-l-4 ${statusBorder}`}
                  >
                    <div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${badgeCls}`}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {rule.title}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      {rule.description}
                    </div>
                    <div className={`font-mono text-sm ${priorityCls}`}>{rule.value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Accepted Document Formats */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="size-8 rounded-lg bg-accent/10 grid place-items-center">
              <FileText className="size-4 text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                Accepted Document Formats
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                File types supported for certificate ingestion
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/20 backdrop-blur-md shadow-xl">
            <div className="divide-y divide-border/30">
              {ACCEPTED_FORMATS.map((fmt) => (
                <div key={fmt.ext} className="flex items-center gap-5 px-6 py-4">
                  <div className="size-10 rounded-xl border border-border/50 bg-foreground/[0.03] grid place-items-center shrink-0">
                    <FileText
                      className={`size-4 ${fmt.supported ? "text-primary" : "text-muted-foreground/40"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground font-mono">{fmt.ext}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{fmt.description}</div>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 font-mono text-[11px] font-bold text-success">
                      <CheckCircle2 className="size-3" />
                      Supported
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="flex items-center justify-between border-t border-border/30 pt-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="size-3.5" />
            <span>
              Rules effective as of{" "}
              <span className="font-mono font-bold text-foreground">2026-01-01</span>
            </span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
            WOM_LifecycleRules · v1.0.0
          </div>
        </div>
      </div>
    </div>
  );
}
