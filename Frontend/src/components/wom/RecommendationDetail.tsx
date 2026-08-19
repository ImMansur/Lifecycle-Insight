import { useState, useMemo } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, PriorityChip } from "./StatusBadge";
import type { Recommendation, LineItem } from "@/lib/wom-data";
import { groupSerialsByPart, getEquipmentNames, formatRecertCountdown } from "@/lib/wom-data";
import { TruncatedText } from "./TruncatedText";
import { updateRecommendation, suggestNextSteps, fetchDocumentUrl } from "@/lib/api";
import type { RecommendationPatch, Action } from "@/lib/api";
import {
  FileText,
  Mail,
  Wrench,
  Calendar,
  Hash,
  Building2,
  Package,
  AlertTriangle,
  Copy,
  Check,
  Pencil,
  X,
  Save,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  Loader2,
  ExternalLink,
  FileSearch,
  ShieldCheck,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,

} from "lucide-react";

/** Duration phrase for email copy, e.g. "12 days" or "3 months" — falls back
 * to exact days when monthsToRecert rounds down to 0 so drafts never read
 * "currently 0 months past" for something that's actually days overdue. */
function recertMagnitude(rec: Recommendation): string {
  if (rec.monthsToRecert === 0 && rec.daysToRecert != null) {
    const d = Math.abs(rec.daysToRecert);
    return `${d} day${d !== 1 ? "s" : ""}`;
  }
  const m = Math.abs(rec.monthsToRecert ?? 0);
  return `${m} month${m !== 1 ? "s" : ""}`;
}

function buildPlainText(rec: Recommendation): string {
  const customer = rec.customer ?? "Valued Customer";
  const equipments = getEquipmentNames(rec);
  const equipment = equipments.length > 0 ? equipments.join(", ") : (rec.equipment ?? "your WOM-manufactured equipment");
  const partList =
    rec.partNumbers.length > 0
      ? rec.partNumbers
          .map((p) => `  • ${p.number}${p.description ? ` – ${p.description}` : ""}`)
          .join("\n")
      : "  —";
  const serialList = rec.serials.length > 0 ? rec.serials.join(", ") : "—";

  let urgency = "";
  if (rec.status === "Expired / overdue") {
    urgency = `This equipment is currently ${recertMagnitude(rec)} past its 5-year recertification window. Prompt action is strongly recommended to maintain API compliance and operational safety. Please treat this as an urgent matter.`;
  } else if (rec.status === "Due soon") {
    urgency = `This equipment is approaching its 5-year recertification window in approximately ${recertMagnitude(rec)}. We recommend scheduling recertification at your earliest convenience to avoid operational disruption.`;
  } else {
    urgency = `This equipment is currently within its mid-cycle service window. Scheduling a proactive inspection or recertification now may reduce lead times and ensure uninterrupted operations.`;
  }

  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subject = `Recertification Notice – ${equipment}${rec.salesOrder ? ` | SO ${rec.salesOrder}` : ""}`;

  return `Subject: ${subject}
To: ${customer}
From: WOM Service Team <service@womgroup.com>
Date: ${date}

Dear ${customer},

I hope this message finds you well.

I am reaching out on behalf of Worldwide Oilfield Machine (WOM) regarding equipment we manufactured for your organization.
${rec.salesOrder ? `\nWOM Sales Order:         ${rec.salesOrder}` : ""}${rec.purchaseOrder ? `\nCustomer Purchase Order: ${rec.purchaseOrder}` : ""}

Our lifecycle management system has identified the following equipment as requiring attention:

  Equipment:           ${equipment}
  Certificate Date:    ${rec.certificateDate ?? "—"}
  Recertification Due: ${rec.recertificationDue ?? "—"}
  Current Status:      ${rec.status}
  Part Number(s):
${partList}
  Serial / Lot:        ${serialList}

${urgency}

WOM offers comprehensive recertification services for all equipment we manufacture. Our team can coordinate collection, full recertification, pressure testing, and re-delivery with minimal downtime to your operations.

To schedule service or discuss your requirements, please contact us:

  📞  +1 (713) 937-9200
  ✉   service@womgroup.com
  🌐  www.womgroup.com
  📍  10820 Tanner Road, Houston, TX 77041

We value your continued partnership and look forward to supporting your operational needs.

Warm regards,

WOM Service & Recertification Team
Worldwide Oilfield Machine
© 2026 Worldwide Oilfield Machine. All Rights Reserved.`;
}

function EmailDraftDialog({
  rec,
  open,
  onOpenChange,
}: {
  rec: Recommendation;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const customer = rec.customer ?? "Valued Customer";
  const equipments = getEquipmentNames(rec);
  const equipment = equipments.length > 0 ? equipments.join(", ") : (rec.equipment ?? "your WOM-manufactured equipment");
  const subject = `Recertification Notice – ${equipment}${rec.salesOrder ? ` | SO ${rec.salesOrder}` : ""}`;
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let urgency = "";
  let urgencyTone = "text-foreground/80";
  if (rec.status === "Expired / overdue") {
    urgency = `This equipment is currently ${recertMagnitude(rec)} past its 5-year recertification window. Prompt action is strongly recommended to maintain API compliance and operational safety. Please treat this as an urgent matter.`;
    urgencyTone = "text-destructive";
  } else if (rec.status === "Due soon") {
    urgency = `This equipment is approaching its 5-year recertification window in approximately ${recertMagnitude(rec)}. We recommend scheduling recertification at your earliest convenience to avoid operational disruption.`;
    urgencyTone = "text-warning";
  } else {
    urgency = `This equipment is currently within its mid-cycle service window. Scheduling a proactive inspection or recertification now may reduce lead times and ensure uninterrupted operations.`;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(buildPlainText(rec));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(90vw,760px)] max-w-none bg-surface border-border p-0 gap-0 overflow-hidden">
        {/* Header bar */}
        <div className="bg-accent px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-white/10 grid place-items-center">
              <Mail className="size-4 text-white" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-white tracking-tight">
                Draft Customer Email
              </DialogTitle>
              <p className="text-[11px] text-white/60 font-mono mt-0.5">
                AI-generated · review before sending
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-8 px-3 text-white/80 hover:text-white hover:bg-white/10 text-xs font-bold"
          >
            Close
          </Button>
        </div>

        {/* Meta fields */}
        <div className="border-b border-border bg-background/40 divide-y divide-border/40 shrink-0">
          <div className="flex items-start gap-4 px-6 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground w-16 shrink-0 pt-0.5">
              Subject
            </span>
            <span className="text-sm font-semibold text-foreground break-words min-w-0">
              {subject}
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border/40">
            <div className="flex items-center gap-4 px-6 py-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground w-16 shrink-0">
                To
              </span>
              <span className="text-sm text-foreground font-medium truncate">{customer}</span>
            </div>
            <div className="flex items-center gap-4 px-6 py-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground w-16 shrink-0">
                From
              </span>
              <span className="text-sm text-foreground font-mono truncate">
                service@womgroup.com
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 px-6 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground w-16 shrink-0">
              Date
            </span>
            <span className="text-sm text-muted-foreground">{date}</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto max-h-[50vh] px-8 py-6 space-y-4 text-sm text-foreground leading-relaxed">
          <p>
            Dear <span className="font-semibold">{customer}</span>,
          </p>
          <p>I hope this message finds you well.</p>
          <p>
            I am reaching out on behalf of{" "}
            <span className="font-semibold">Worldwide Oilfield Machine (WOM)</span> regarding
            equipment we manufactured for your organization.
          </p>

          {/* Equipment table */}
          <div className="rounded-xl border border-border bg-background/50 overflow-hidden">
            <div className="bg-foreground/[0.03] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground border-b border-border">
              Equipment Details
            </div>
            <div className="divide-y divide-border/50">
              {[
                { label: "Equipment", value: equipment },
                ...(rec.salesOrder ? [{ label: "WOM Sales Order", value: rec.salesOrder }] : []),
                ...(rec.purchaseOrder ? [{ label: "Customer PO", value: rec.purchaseOrder }] : []),
                { label: "Certificate Date", value: rec.certificateDate ?? "—" },
                { label: "Recertification Due", value: rec.recertificationDue ?? "—" },
                { label: "Current Status", value: rec.status },
              ].map(({ label, value }) => (
                <div key={label} className="grid grid-cols-[160px_1fr] gap-4 px-4 py-2.5">
                  <span className="text-xs font-semibold text-muted-foreground shrink-0">
                    {label}
                  </span>
                  <span className="text-sm font-mono text-foreground break-all">{value}</span>
                </div>
              ))}
              {(() => {
                const { groups, unattributedSerials } = groupSerialsByPart(rec);
                if (groups.length === 0 && unattributedSerials.length === 0) return null;
                return (
                  <div className="px-4 py-3 space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">
                      Parts &amp; Serials ({groups.length} part{groups.length !== 1 ? "s" : ""} ·{" "}
                      {rec.serials.length} serial{rec.serials.length !== 1 ? "s" : ""})
                    </div>
                    {groups.map((g) => (
                      <div
                        key={g.part.number}
                        className="rounded-lg border border-border bg-background p-2.5"
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
                              — <TruncatedText text={g.part.description} limit={80} />
                            </span>
                          )}
                        </div>
                        {g.serials.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {g.serials.map((s) => (
                              <span
                                key={s}
                                className="rounded bg-accent/10 border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] text-accent"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                        {g.lotBatchNumbers.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                              Lot/Batch:
                            </span>
                            {g.lotBatchNumbers.map((s) => (
                              <span
                                key={s}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                        {g.expirationDate && (
                          <div className="mt-1 text-[9px] text-muted-foreground">
                            <span className="uppercase tracking-wide">Exp:</span> {g.expirationDate}
                          </div>
                        )}
                        {g.soLotBatchExp && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                              S/O Lot &amp; Batch / Exp:
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {g.soLotBatchExp}
                            </span>
                          </div>
                        )}
                        {(g.invoiceNumber || g.workOrder) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
                            {g.invoiceNumber && (
                              <span>
                                <span className="uppercase tracking-wide">Invoice:</span>{" "}
                                <span className="font-mono">{g.invoiceNumber}</span>
                              </span>
                            )}
                            {g.workOrder && (
                              <span>
                                <span className="uppercase tracking-wide">W.O.:</span>{" "}
                                <span className="font-mono">{g.workOrder}</span>
                              </span>
                            )}
                          </div>
                        )}
                        {g.specifications && (
                          <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                            <span className="font-semibold uppercase tracking-wide">Specs: </span>
                            <TruncatedText text={g.specifications} limit={100} />
                          </div>
                        )}
                      </div>
                    ))}
                    {unattributedSerials.length > 0 && (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Other serials ({unattributedSerials.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {unattributedSerials.map((s) => (
                            <span
                              key={s}
                              className="rounded bg-accent/10 border border-accent/30 px-2 py-0.5 font-mono text-xs text-accent"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <p className={`font-medium ${urgencyTone}`}>{urgency}</p>

          <p>
            WOM offers comprehensive recertification services for all equipment we manufacture. Our
            team can coordinate collection, full recertification, pressure testing, and re-delivery
            with minimal downtime to your operations.
          </p>

          <p>To schedule service or discuss your requirements, please contact us:</p>

          <div className="rounded-xl border border-border bg-background/50 px-5 py-4 space-y-2">
            {[
              { icon: "📞", text: "+1 (713) 937-9200" },
              { icon: "✉", text: "service@womgroup.com" },
              { icon: "🌐", text: "www.womgroup.com" },
              { icon: "📍", text: "10820 Tanner Road, Houston, TX 77041" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-sm">
                <span className="text-base">{icon}</span>
                <span className="font-mono text-foreground/80">{text}</span>
              </div>
            ))}
          </div>

          <p>
            We value your continued partnership and look forward to supporting your operational
            needs.
          </p>

          <div className="pt-2 border-t border-border/40">
            <p className="font-semibold text-foreground">Warm regards,</p>
            <p className="mt-2 text-muted-foreground">WOM Service &amp; Recertification Team</p>
            <p className="text-muted-foreground font-semibold">Worldwide Oilfield Machine</p>
            <p className="text-[11px] text-muted-foreground/60 mt-2">
              © 2026 Worldwide Oilfield Machine. All Rights Reserved.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex items-center justify-between bg-background/30 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            Review and personalise before sending via your email client.
          </p>
          <Button
            size="sm"
            onClick={handleCopy}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-8"
          >
            {copied ? (
              <>
                <Check className="mr-1.5 size-3.5" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-3.5" />
                Copy Email
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function AiSuggestionsInline({ actionId }: { actionId: string | undefined }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setSteps(newSteps);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" /> AI Next Steps
        </span>
        <button
          onClick={generate}
          disabled={loading || !actionId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-3" /> {steps.length ? "Regenerate" : "Generate"}
            </>
          )}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
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
      {!loading && steps.length === 0 && !error && (
        <p className="text-xs text-muted-foreground/50 italic">
          Click "Generate" for AI-suggested next steps.
        </p>
      )}
    </div>
  );
}

export function RecommendationDetail({
  rec,
  open,
  onOpenChange,
  linkedAction,
  onNext,
  onPrev,
}: {
  rec: Recommendation | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  linkedAction?: Action | null;
  onNext?: () => void;
  onPrev?: () => void;
}) {

  const [emailOpen, setEmailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RecommendationPatch>({});
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set());
  const [viewDoc, setViewDoc] = useState(false);
  const qc = useQueryClient();

  const {
    data: docData,
    isFetching: docLoading,
    error: docError,
  } = useQuery({
    queryKey: ["docUrl", rec?.sourceFile],
    queryFn: () => fetchDocumentUrl(rec!.sourceFile),
    enabled: viewDoc && !!rec?.sourceFile,
    staleTime: 23 * 60 * 60 * 1000, // refetch after 23 h, SAS valid for 24 h
  });

  const saveMutation = useMutation({
    mutationFn: (patch: RecommendationPatch) => updateRecommendation(rec!.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      setEditing(false);
      setDraft({});
    },
  });

  if (!rec) return null;
  const overdue = rec.status === "Expired / overdue";
  const actionable = rec.status === "Expired / overdue" || rec.status === "Due soon";
  const withinLifecycle = !actionable;
  const needsReview =
    rec.confidence === "Low" || rec.extractionStatus === "Needs OCR / manual review";

  // Fields missing from the original extraction
  const missingFields = [
    !rec.customer && "Customer",
    !rec.equipment && "Equipment",
    !rec.salesOrder && "Sales Order",
    !rec.certificateDate && "Certificate Date",
    rec.partNumbers.length === 0 && "Part Numbers",
    rec.serials.length === 0 && "Serials",
  ].filter(Boolean) as string[];

  function startEditing() {
    setDraft({
      customer: rec!.customer ?? "",
      salesOrder: rec!.salesOrder ?? "",
      purchaseOrder: rec!.purchaseOrder ?? "",
      jobOrProject: rec!.jobOrProject ?? "",
      location: rec!.location ?? "",
      equipment: rec!.equipment ?? "",
      certificateDate: rec!.certificateDate ?? "",
      testedDate: rec!.testedDate ?? "",
      docLotBatchNumber: rec!.docLotBatchNumber ?? "",
      docExpirationDate: rec!.docExpirationDate ?? "",
      docCureDate: rec!.docCureDate ?? "",
      applicableSpecs: rec!.applicableSpecs ?? "",
      authorizedSignatory: rec!.authorizedSignatory ?? "",
      signatoryTitle: rec!.signatoryTitle ?? "",
      serials: rec!.serials,
      // Structured per-part rows are the source of truth. Older records with
      // no lineItems yet get one synthesized per flat part number so every
      // part is still individually editable rather than falling back to a
      // single opaque serials list.
      lineItems:
        rec!.lineItems.length > 0
          ? rec!.lineItems.map((li) => ({
              ...li,
              serials: [...li.serials],
              lotBatchNumbers: [...li.lotBatchNumbers],
            }))
          : rec!.partNumbers.map((p) => ({
              description: p.description,
              partNumber: p.number,
              qty: p.qty,
              serials: [],
              lotBatchNumbers: [],
              expirationDate: null,
              soLotBatchExp: null,
              specifications: null,
              invoiceNumber: null,
              workOrder: null,
            })),
      notes: rec!.notes ?? "",
      priority: rec!.priority as "High" | "Low" | "Manual review",
    });
    setExpandedParts(new Set());
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft({});
    saveMutation.reset();
  }

  function toggleExpanded(index: number) {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setDraft((prev) => {
      const items = [...(prev.lineItems ?? [])];
      items[index] = { ...items[index], ...patch };
      return { ...prev, lineItems: items };
    });
  }

  function addLineItem() {
    const newIndex = (draft.lineItems ?? []).length;
    setDraft((prev) => ({
      ...prev,
      lineItems: [
        ...(prev.lineItems ?? []),
        {
          description: "",
          partNumber: "",
          qty: null,
          serials: [],
          lotBatchNumbers: [],
          expirationDate: "",
          soLotBatchExp: "",
          specifications: "",
          invoiceNumber: "",
          workOrder: "",
        },
      ],
    }));
    // New parts start expanded so they can be filled in right away.
    setExpandedParts((prev) => new Set(prev).add(newIndex));
  }

  function removeLineItem(index: number) {
    setDraft((prev) => ({
      ...prev,
      lineItems: (prev.lineItems ?? []).filter((_, i) => i !== index),
    }));
    setExpandedParts((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  }

  function handleSave() {
    // Strip empty strings → omit from patch (keep original value)
    const patch: RecommendationPatch = {};
    const d = draft as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) {
      if (k === "serials") {
        patch.serials = (v as string[]).filter(Boolean);
      } else if (k === "lineItems") {
        patch.lineItems = (v as LineItem[])
          .map((li) => ({
            ...li,
            description: li.description?.trim() || null,
            partNumber: li.partNumber?.trim() || null,
            specifications: li.specifications?.trim() || null,
            expirationDate: li.expirationDate?.trim() || null,
            soLotBatchExp: li.soLotBatchExp?.trim() || null,
            invoiceNumber: li.invoiceNumber?.trim() || null,
            workOrder: li.workOrder?.trim() || null,
            serials: li.serials.map((s) => s.trim()).filter(Boolean),
            lotBatchNumbers: li.lotBatchNumbers.map((s) => s.trim()).filter(Boolean),
          }))
          .filter(
            (li) =>
              li.description ||
              li.partNumber ||
              li.qty != null ||
              li.serials.length > 0 ||
              li.lotBatchNumbers.length > 0 ||
              li.expirationDate ||
              li.soLotBatchExp ||
              li.specifications ||
              li.invoiceNumber ||
              li.workOrder,
          );
      } else if (k === "priority") {
        if (v) patch.priority = v as "High" | "Low" | "Manual review";
      } else if (typeof v === "string" && v.trim() !== "") {
        (patch as Record<string, unknown>)[k] = v.trim();
      }
    }
    saveMutation.mutate(patch);
  }

  function field(key: keyof RecommendationPatch, label: string, multiline = false) {
    const val = ((draft as Record<string, unknown>)[key] as string) ?? "";
    const original = (rec as unknown as Record<string, unknown>)[key];
    const isMissing = !original;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          {isMissing && (
            <span className="flex items-center gap-0.5 rounded bg-warning/15 px-1 py-px text-[9px] font-bold text-warning uppercase tracking-wide">
              <AlertTriangle className="size-2.5" /> missing
            </span>
          )}
        </div>
        {multiline ? (
          <Textarea
            value={val}
            onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
            rows={2}
            className="resize-none text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
            placeholder={`Enter ${label.toLowerCase()}…`}
          />
        ) : (
          <Input
            value={val}
            onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
            className={`h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50 ${isMissing ? "border-warning/50 focus:border-warning" : ""}`}
            placeholder={`Enter ${label.toLowerCase()}…`}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            cancelEditing();
            setViewDoc(false);
          }
          onOpenChange(v);
        }}
      >
        <SheetContent
          side="right"
          className={`border-l border-border bg-surface p-0 transition-all duration-300 ${viewDoc ? "w-full sm:max-w-[1600px] overflow-hidden flex flex-row" : "w-full sm:max-w-[640px] overflow-y-auto"}`}
        >
          {/* ── DOCUMENT VIEWER PANEL (left side when active) ───────────── */}
          {viewDoc && (
            <div
              className="flex flex-col border-r border-border/50 bg-background/40"
              style={{ width: "55%", minWidth: 0 }}
            >
              <div className="flex items-center justify-between border-b border-border/40 bg-surface/80 px-4 py-3 backdrop-blur">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSearch className="size-4 text-primary/60 shrink-0" />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {rec.sourceFile}
                  </span>
                </div>
                {docData?.url && (
                  <a
                    href={docData.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
                    title="Open in new tab"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              <div className="flex-1 relative">
                {docLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60">
                    <Loader2 className="size-8 animate-spin text-primary/40" />
                    <p className="text-xs text-muted-foreground">Loading document…</p>
                  </div>
                )}
                {docError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <AlertTriangle className="size-8 text-destructive/50" />
                    <p className="text-sm font-medium text-destructive/70">
                      Could not load document
                    </p>
                    <p className="text-xs text-muted-foreground">{(docError as Error).message}</p>
                  </div>
                )}
                {docData?.url &&
                  !docLoading &&
                  (() => {
                    const ext = rec.sourceFile.split(".").pop()?.toLowerCase() ?? "";
                    const isDocx = ext === "docx" || ext === "doc";
                    const src = isDocx
                      ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(docData.url)}`
                      : docData.url;
                    return (
                      <iframe
                        key={docData.url}
                        src={src}
                        className="h-full w-full border-0"
                        title={rec.sourceFile}
                      />
                    );
                  })()}
              </div>
            </div>
          )}

          {/* ── DETAIL PANEL (always visible) ───────────────────────────── */}
          <div className={`flex flex-col ${viewDoc ? "flex-1 min-w-0 overflow-y-auto" : "w-full"}`}>
            <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
              <SheetHeader className="space-y-3 text-left">
                <div className="flex items-center gap-2">
                  <PriorityChip priority={rec.priority} />
                  <StatusBadge status={rec.status} />
                  {onPrev && (
                    <button
                      onClick={onPrev}
                      className="ml-2 rounded-lg border border-border/50 bg-secondary/50 p-1 text-muted-foreground hover:text-foreground transition-all hover:bg-secondary"
                      title="Previous record"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                  )}
                  {onNext && (
                    <button
                      onClick={onNext}
                      className="rounded-lg border border-border/50 bg-secondary/50 p-1 text-muted-foreground hover:text-foreground transition-all hover:bg-secondary"
                      title="Next record"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  )}

                  {needsReview && !editing && (
                    <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                      <AlertTriangle className="size-3" />
                      {missingFields.length > 0
                        ? `${missingFields.length} field${missingFields.length > 1 ? "s" : ""} missing`
                        : "Low confidence"}
                    </span>
                  )}
                  {!needsReview && !editing && (
                    <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                      <CheckCircle2 className="size-3" /> Verified
                    </span>
                  )}
                  <button
                    onClick={() => setViewDoc((v) => !v)}
                    className={`ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                      viewDoc
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/50 bg-secondary/50 text-muted-foreground hover:text-foreground"
                    }`}
                    title="Toggle original document view"
                  >
                    <FileSearch className="size-3.5" />
                    {viewDoc ? "Hide Doc" : "View Doc"}
                  </button>
                </div>
                <SheetTitle className="font-display text-xl leading-tight text-foreground">
                  {rec.customer ?? rec.sourceFile}
                </SheetTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5" />
                  <span className="font-mono truncate">{rec.sourceFile}</span>
                </div>
                {rec.convertedDocx && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="size-3.5 text-primary/50" />
                    <span className="text-primary/70">Converted:</span>
                    <span className="font-mono truncate">{rec.convertedDocx}</span>
                  </div>
                )}
              </SheetHeader>
            </div>

            {/* ── EDIT MODE ──────────────────────────────────────────────── */}
            {editing ? (
              <div className="px-6 py-6 space-y-6">
                {/* Banner */}
                <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4">
                  <Pencil className="mt-0.5 size-4 text-warning shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-warning">Manual field correction</p>
                    <p className="mt-0.5 text-xs text-warning/80">
                      Fill in missing or incorrect fields. On save the record will be marked as{" "}
                      <strong>Verified (High confidence)</strong>.
                    </p>
                    {missingFields.length > 0 && (
                      <p className="mt-2 text-xs text-warning/70">
                        Missing:{" "}
                        <span className="font-mono font-bold">{missingFields.join(", ")}</span>
                      </p>
                    )}
                  </div>
                </div>

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-amber flex items-center gap-2">
                    <Building2 className="size-3.5" /> Customer &amp; Order
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {field("customer", "Customer")}
                    {field("equipment", "Equipment")}
                    {field("salesOrder", "Sales Order")}
                    {field("purchaseOrder", "Purchase Order")}
                    {field("jobOrProject", "Job / Project")}
                    {field("location", "Location")}
                  </div>
                  {/* Priority */}
                  <div className="mt-4 space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Priority
                    </span>
                    <div className="flex gap-2 mt-1">
                      {(["High", "Low"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, priority: p }))}
                          className={`rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all ${
                            draft.priority === p
                              ? p === "High"
                                ? "bg-primary/10 border-primary/40 text-primary"
                                : p === "Low"
                                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600"
                                  : "bg-muted border-border text-muted-foreground"
                              : "border-border/40 text-muted-foreground/50 hover:border-border hover:text-muted-foreground"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <Separator className="bg-border" />

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-amber flex items-center gap-2">
                    <ShieldCheck className="size-3.5" /> Certification
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {field("authorizedSignatory", "Authorized Signatory")}
                    {field("signatoryTitle", "Signatory Title")}
                  </div>
                  <div className="mt-4">{field("applicableSpecs", "Applicable Specs", true)}</div>
                </section>

                <Separator className="bg-border" />

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-amber flex items-center gap-2">
                    <Calendar className="size-3.5" /> Dates
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {field("certificateDate", "Certificate Date")}
                    {field("testedDate", "Tested Date")}
                  </div>
                </section>

                <Separator className="bg-border" />

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-amber flex items-center gap-2">
                    <Package className="size-3.5" /> Parts &amp; Serials
                  </h3>

                  {/* Document-wide metadata note */}
                  <div className="mb-5 rounded-lg border border-amber/30 bg-amber/5 p-3">
                    <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-amber">
                      Document-wide note (applies to whole certificate, not one part)
                    </span>
                    <div className="grid grid-cols-3 gap-3">
                      {field("docLotBatchNumber", "Lot / Batch")}
                      {field("docExpirationDate", "Expiration")}
                      {field("docCureDate", "Cure Date")}
                    </div>
                  </div>

                  {/* Per-part rows */}
                  <div className="space-y-2">
                    {(draft.lineItems ?? []).map((li, i) => {
                      const isExpanded = expandedParts.has(i);
                      const summaryLabel =
                        li.partNumber || li.description || `Part ${i + 1}`;
                      return (
                        <div
                          key={i}
                          className="rounded-lg border border-border/60 bg-background/40 overflow-hidden"
                        >
                          {/* Collapsed summary header — click to expand/collapse */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleExpanded(i)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleExpanded(i);
                              }
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer hover:bg-muted/40 transition-colors"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Part {i + 1}
                              </span>
                              <span className="truncate text-sm font-medium text-foreground">
                                {summaryLabel}
                              </span>
                              {li.qty != null && (
                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                                  {li.qty}×
                                </span>
                              )}
                              {li.serials.filter(Boolean).length > 0 && (
                                <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                                  {li.serials.filter(Boolean).length} serial
                                  {li.serials.filter(Boolean).length !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeLineItem(i);
                              }}
                              className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="size-3" /> Remove
                            </button>
                          </div>

                          {/* Expanded detail editor */}
                          {isExpanded && (
                            <div className="space-y-3 border-t border-border/60 p-3">
                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  Description
                                </span>
                                <Textarea
                                  value={li.description ?? ""}
                                  onChange={(e) => updateLineItem(i, { description: e.target.value })}
                                  rows={2}
                                  className="resize-none text-sm bg-background/60 border-border/60 focus:border-primary/50"
                                  placeholder="Part description…"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Part Number
                                  </span>
                                  <Input
                                    value={li.partNumber ?? ""}
                                    onChange={(e) => updateLineItem(i, { partNumber: e.target.value })}
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. PN-1234"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Qty
                                  </span>
                                  <Input
                                    type="number"
                                    value={li.qty ?? ""}
                                    onChange={(e) =>
                                      updateLineItem(i, {
                                        qty: e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. 2"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Serial / Lot Numbers
                                  </span>
                                  <Input
                                    value={li.serials.join(", ")}
                                    onChange={(e) =>
                                      updateLineItem(i, {
                                        serials: e.target.value.split(",").map((s) => s.trim()),
                                      })
                                    }
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. SN-001, SN-002"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Lot / Batch Numbers
                                  </span>
                                  <Input
                                    value={li.lotBatchNumbers.join(", ")}
                                    onChange={(e) =>
                                      updateLineItem(i, {
                                        lotBatchNumbers: e.target.value.split(",").map((s) => s.trim()),
                                      })
                                    }
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. B-100"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Expiration Date
                                  </span>
                                  <Input
                                    value={li.expirationDate ?? ""}
                                    onChange={(e) => updateLineItem(i, { expirationDate: e.target.value })}
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. 2027Q4"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    S/O Lot &amp; Batch / Exp. (combined)
                                  </span>
                                  <Input
                                    value={li.soLotBatchExp ?? ""}
                                    onChange={(e) => updateLineItem(i, { soLotBatchExp: e.target.value })}
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. 23810 / 4249260-12 / 3Q17"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Invoice
                                  </span>
                                  <Input
                                    value={li.invoiceNumber ?? ""}
                                    onChange={(e) => updateLineItem(i, { invoiceNumber: e.target.value })}
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. INV-200555"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    Work Order
                                  </span>
                                  <Input
                                    value={li.workOrder ?? ""}
                                    onChange={(e) => updateLineItem(i, { workOrder: e.target.value })}
                                    className="h-8 text-sm font-mono bg-background/60 border-border/60 focus:border-primary/50"
                                    placeholder="e.g. W-115835"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  Specifications
                                </span>
                                <Textarea
                                  value={li.specifications ?? ""}
                                  onChange={(e) => updateLineItem(i, { specifications: e.target.value })}
                                  rows={2}
                                  className="resize-none text-sm bg-background/60 border-border/60 focus:border-primary/50"
                                  placeholder="Ratings / pressure / temperature / compliance block…"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={addLineItem}
                    className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] font-bold text-muted-foreground hover:border-primary/40 hover:text-primary"
                  >
                    <Plus className="size-3.5" /> Add Part
                  </button>
                </section>

                <Separator className="bg-border" />

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-amber flex items-center gap-2">
                    <Wrench className="size-3.5" /> Notes
                  </h3>
                  {field("notes", "Notes", true)}
                </section>

                {saveMutation.isError && (
                  <p className="text-sm text-destructive font-medium">
                    Save failed: {(saveMutation.error as Error).message}
                  </p>
                )}

                {/* Save / Cancel */}
                <div className="sticky bottom-0 -mx-6 flex gap-2 border-t border-border bg-surface/95 px-6 py-4 backdrop-blur">
                  <Button
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
                  >
                    {saveMutation.isPending ? (
                      <>
                        <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white/30 border-t-white inline-block" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 size-4" />
                        Save &amp; Mark Verified
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={cancelEditing} disabled={saveMutation.isPending}>
                    <X className="mr-2 size-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="px-6 py-6 space-y-8">
                {overdue && (
                  <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                    <AlertTriangle className="mt-0.5 size-4 text-destructive" />
                    <div>
                      <div className="text-sm font-semibold text-destructive">
                        Recertification {formatRecertCountdown(rec)}
                      </div>
                      <div className="mt-1 text-xs text-destructive/80">
                        Recommend immediate outreach. Equipment is past its 5-year recertification
                        window.
                      </div>
                    </div>
                  </div>
                )}

                {/* Customer & Order */}
                <section>
                  <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                    <Building2 className="size-3.5" /> Customer & Order
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Field label="Customer" value={rec.customer} />
                    <Field
                      label="Equipment"
                      value={(() => {
                        const equipments = getEquipmentNames(rec);
                        const primary = rec.equipment || equipments[0];
                        if (!primary) return null;
                        const partCount = rec.lineItems?.length ?? 0;
                        return (
                          <div className="mt-1 space-y-1">
                            <span className="inline-block bg-slate-50 text-slate-800 border border-slate-200/60 rounded px-2 py-0.5 font-semibold text-[11px] leading-normal shadow-sm">
                              <TruncatedText text={primary} limit={120} />
                            </span>
                            {partCount > 1 && (
                              <div className="text-[10px] text-muted-foreground">
                                Full itemized breakdown ({partCount} parts) in Parts &amp; Serials below
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    />
                    <Field label="Job / Project" value={rec.jobOrProject} />
                    <Field label="Sales Order" value={rec.salesOrder} mono />
                    <Field label="Customer Purchase Order" value={rec.purchaseOrder} mono />
                  </div>
                </section>

                {(rec.applicableSpecs || rec.authorizedSignatory || rec.signatoryTitle) && (
                  <>
                    <Separator className="bg-border" />

                    {/* Certification */}
                    <section>
                      <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                        <ShieldCheck className="size-3.5" /> Certification
                      </h3>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                        <Field
                          label="Applicable Specs"
                          value={rec.applicableSpecs ? <TruncatedText text={rec.applicableSpecs} limit={140} /> : null}
                        />
                        <Field label="Authorized Signatory" value={rec.authorizedSignatory} />
                        <Field label="Signatory Title" value={rec.signatoryTitle} />
                      </div>
                    </section>
                  </>
                )}

                <Separator className="bg-border" />

                {/* Lifecycle */}
                <section>
                  <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                    <Calendar className="size-3.5" /> Lifecycle
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Field label="Certificate Date" value={rec.certificateDate} mono />
                    <Field label="Tested Date" value={rec.testedDate} mono />
                    <Field label="Recertification Due" value={rec.recertificationDue} mono />
                    <Field
                      label="Age (months)"
                      value={rec.ageMonths !== null ? `${rec.ageMonths} mo` : null}
                      mono
                    />
                  </div>
                </section>

                <Separator className="bg-border" />

                {/* Parts & Serials */}
                <section>
                  <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                    <Package className="size-3.5" /> Parts & Serials
                  </h3>
                  {(rec.docLotBatchNumber || rec.docExpirationDate || rec.docCureDate) && (
                    <div className="mb-4 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                      <span className="font-semibold uppercase tracking-wide text-amber">
                        Document-wide note:
                      </span>{" "}
                      Certificate footer states
                      {rec.docLotBatchNumber && <> lot/batch <span className="font-medium">{rec.docLotBatchNumber}</span></>}
                      {rec.docLotBatchNumber && (rec.docExpirationDate || rec.docCureDate) && ","}
                      {rec.docExpirationDate && <> expiration <span className="font-medium">{rec.docExpirationDate}</span></>}
                      {rec.docExpirationDate && rec.docCureDate && ","}
                      {rec.docCureDate && <> cure date <span className="font-medium">{rec.docCureDate}</span></>}
                      {" "}for the certificate as a whole — not tied to a specific part below.
                    </div>
                  )}
                  {(() => {
                    const { groups, unattributedSerials } = groupSerialsByPart(rec);
                    if (groups.length === 0 && unattributedSerials.length === 0) {
                      return <span className="text-sm text-muted-foreground">—</span>;
                    }
                    const hasLotBatch = groups.some((g) => g.lotBatchNumbers.length > 0);
                    const hasExpiration = groups.some((g) => g.expirationDate);
                    const hasSoLotBatchExp = groups.some((g) => g.soLotBatchExp);
                    const hasInvoiceOrWorkOrder = groups.some((g) => g.invoiceNumber || g.workOrder);
                    return (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <span>
                            {groups.length} part{groups.length !== 1 ? "s" : ""}
                          </span>
                          <span className="text-border">·</span>
                          <span>
                            {rec.serials.length} serial{rec.serials.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 select-none">
                                <th className="py-2 px-3">Description</th>
                                <th className="py-2 px-3 w-[140px]">Part No</th>
                                <th className="py-2 px-3 w-[60px] text-center">Qty</th>
                                <th className="py-2 px-3 min-w-[140px]">Serial No</th>
                                {hasLotBatch && (
                                  <th className="py-2 px-3 min-w-[120px]">Lot/Batch No</th>
                                )}
                                {hasExpiration && (
                                  <th className="py-2 px-3 w-[100px]">Exp.</th>
                                )}
                                {hasSoLotBatchExp && (
                                  <th className="py-2 px-3 min-w-[150px]">S/O Lot &amp; Batch / Exp.</th>
                                )}
                                {hasInvoiceOrWorkOrder && (
                                  <th className="py-2 px-3 min-w-[130px]">Invoice / W.O.</th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {groups.map((g) => (
                                <tr key={g.part.number} className="hover:bg-slate-50/40 transition-colors">
                                  {/* Description */}
                                  <td className="py-2.5 px-3 max-w-[420px] text-slate-700 font-medium leading-normal">
                                    {g.part.description ? (
                                      <TruncatedText text={g.part.description} limit={160} />
                                    ) : (
                                      <span className="text-slate-400 italic font-normal">No description</span>
                                    )}
                                    {g.specifications && (
                                      <div className="mt-1 border-t border-slate-100 pt-1 text-[10px] font-normal leading-relaxed text-slate-400">
                                        <span className="font-semibold uppercase tracking-wide">Specs: </span>
                                        <TruncatedText text={g.specifications} limit={100} />
                                      </div>
                                    )}
                                  </td>
                                  
                                  {/* Part No */}
                                  <td className="py-2.5 px-3 align-middle">
                                    <span className="inline-block font-mono font-bold text-[11px] text-slate-800 bg-slate-50 border border-slate-200/80 rounded px-1.5 py-0.5 shadow-sm">
                                      {g.part.number}
                                    </span>
                                  </td>
                                  
                                  {/* Qty */}
                                  <td className="py-2.5 px-3 text-center align-middle">
                                    {g.part.qty != null ? (
                                      <span className="inline-block bg-amber-50 border border-amber-200/60 text-amber-700 font-bold font-mono text-[11px] rounded px-1.5 py-0.5">
                                        {g.part.qty}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  
                                  {/* Serial No */}
                                  <td className="py-2.5 px-3 align-middle">
                                    {g.serials.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {g.serials.map((s) => (
                                          <span
                                            key={s}
                                            className="inline-flex items-center rounded border border-accent/20 bg-accent/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent"
                                          >
                                            <Hash className="mr-0.5 inline size-2.5" />
                                            {s}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-300 font-mono text-[10px]">—</span>
                                    )}
                                  </td>

                                  {/* Lot/Batch No */}
                                  {hasLotBatch && (
                                    <td className="py-2.5 px-3 align-middle">
                                      {g.lotBatchNumbers.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                          {g.lotBatchNumbers.map((s) => (
                                            <span
                                              key={s}
                                              className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-600"
                                            >
                                              {s}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-slate-300 font-mono text-[10px]">—</span>
                                      )}
                                    </td>
                                  )}

                                  {/* Expiration */}
                                  {hasExpiration && (
                                    <td className="py-2.5 px-3 align-middle font-mono text-[10px] text-slate-600">
                                      {g.expirationDate ?? <span className="text-slate-300">—</span>}
                                    </td>
                                  )}

                                  {/* Combined S/O Lot & Batch / Exp. */}
                                  {hasSoLotBatchExp && (
                                    <td className="py-2.5 px-3 align-middle font-mono text-[10px] text-slate-600">
                                      {g.soLotBatchExp ?? <span className="text-slate-300">—</span>}
                                    </td>
                                  )}

                                  {/* Invoice / Work Order */}
                                  {hasInvoiceOrWorkOrder && (
                                    <td className="py-2.5 px-3 align-middle font-mono text-[10px] text-slate-600">
                                      {g.invoiceNumber || g.workOrder ? (
                                        <div className="space-y-0.5">
                                          {g.invoiceNumber && <div>Inv: {g.invoiceNumber}</div>}
                                          {g.workOrder && <div>W.O.: {g.workOrder}</div>}
                                        </div>
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        
                        {unattributedSerials.length > 0 && (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/30 p-3.5 mt-2">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full bg-slate-400" />
                              Unattributed / Other Serials ({unattributedSerials.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {unattributedSerials.map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center rounded border border-accent/20 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent"
                                >
                                  <Hash className="mr-1 size-2.5" />
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

                <Separator className="bg-border" />

                {/* Recommendation */}
                <section>
                  <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                    <Wrench className="size-3.5" /> AI Recommendation
                    <span className="ml-auto rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      conf · {rec.confidence}
                    </span>
                  </h3>
                  <p className="rounded-lg border border-border bg-surface-elevated p-4 text-sm leading-relaxed text-foreground">
                    {rec.recommendation}
                  </p>
                  {rec.invoiceBasis && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">Invoice basis: </span>
                      {rec.invoiceBasis}
                    </div>
                  )}
                  {rec.notes && (
                    <div className="mt-2 text-xs text-muted-foreground italic">{rec.notes}</div>
                  )}
                </section>

                {/* Updates: linked action comments + AI suggestions */}
                {linkedAction && (
                  <>
                    <Separator className="bg-border" />
                    <section className="space-y-6">
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber">
                        <MessageSquare className="size-3.5" /> Updates
                        {/* Action status pill */}
                        {(() => {
                          const meta: Record<string, { label: string; cls: string }> = {
                            in_progress: {
                              label: "In Progress",
                              cls: "text-orange-600 bg-orange-500/10 border-orange-500/25",
                            },
                            closed: {
                              label: "Closed",
                              cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/25",
                            },
                            failed: {
                              label: "Failed",
                              cls: "text-red-600 bg-red-500/10 border-red-500/25",
                            },
                          };
                          const m = meta[linkedAction.status];
                          return m ? (
                            <span
                              className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold ${m.cls}`}
                            >
                              <span className="size-1.5 rounded-full bg-current" />
                              {m.label}
                            </span>
                          ) : null;
                        })()}
                      </h3>

                      {/* Comments */}
                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Comments (
                          {linkedAction.comments.filter((c) => c.type !== "ai_suggestion").length})
                        </div>
                        {linkedAction.comments.filter((c) => c.type !== "ai_suggestion").length ===
                        0 ? (
                          <p className="text-xs text-muted-foreground/50 italic">
                            No comments yet.
                          </p>
                        ) : (
                          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                            {linkedAction.comments.map((c) => {
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
                                  className={`rounded-xl border px-4 py-3 ${
                                    isAI
                                      ? "border-primary/25 bg-primary/5"
                                      : "border-border bg-surface-elevated"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    {isAI && (
                                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary tracking-wide">
                                        AI
                                      </span>
                                    )}
                                    <span className="text-[11px] font-bold text-foreground">
                                      {c.author}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                                      {new Date(c.createdAt).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      })}
                                    </span>
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
                                          <span className="text-sm text-foreground/90 leading-snug">
                                            {step}
                                          </span>
                                        </li>
                                      ))}
                                    </ol>
                                  ) : (
                                    <p className="text-sm text-foreground/85 leading-snug">
                                      {c.text}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {/* Actions */}
                <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-2 border-t border-border bg-surface/95 px-6 py-4 backdrop-blur">
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => setEmailOpen(true)}
                    disabled={withinLifecycle}
                    title={
                      withinLifecycle
                        ? "No outreach needed — equipment is within its lifecycle"
                        : undefined
                    }
                  >
                    <Mail className="mr-2 size-4" />
                    Draft Customer Email
                  </Button>
                  <Button
                    variant="outline"
                    className="border-amber-500/40 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    onClick={startEditing}
                  >
                    <Pencil className="mr-2 size-4" />
                    Edit Fields
                  </Button>
                  <Button variant="ghost" className="ml-auto text-muted-foreground">
                    Mark reviewed
                  </Button>
                </div>
              </div>
            )}
          </div>
          {/* end detail panel */}
        </SheetContent>
      </Sheet>

      <EmailDraftDialog rec={rec} open={emailOpen} onOpenChange={setEmailOpen} />
    </>
  );
}
