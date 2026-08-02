export type PartEntry = {
  number: string;
  description: string | null;
  qty: number | null;
};

/** One row from the CoC's equipment table — keeps description, part,
 *  qty and serials grouped together (the relationship that flat arrays lose). */
export type LineItem = {
  description: string | null;
  partNumber: string | null;
  qty: number | null;
  /** TRUE unit serial numbers only. */
  serials: string[];
  /** Lot / batch numbers for this row — a distinct concept from a serial number. */
  lotBatchNumbers: string[];
  /** Expiration / cure-date string for this row, if stated. */
  expirationDate: string | null;
  /** Some templates print S.O. / Lot & Batch / Expiration together as ONE
   *  combined column (e.g. "23810 / 4249260-12 / 3Q17"). Preserved verbatim
   *  as printed instead of being split apart. */
  soLotBatchExp: string | null;
  /** Technical ratings/spec block (rated pressure, design temperature,
   *  NACE/sour-service compliance, H2S/CO2/chloride/pH limits, etc.) that
   *  some templates print directly below the description. Kept separate
   *  from "description" so the equipment name/description stays short. */
  specifications: string | null;
  /** Invoice number stated for THIS specific row, when the source shows it
   *  as its own distinct column (distinct from the document-level
   *  salesOrder/purchaseOrder). */
  invoiceNumber: string | null;
  /** Work order / W.O. reference stated for THIS specific row. */
  workOrder: string | null;
};

export type Recommendation = {
  id: string;
  sourceFile: string;
  sourceType: "PDF" | "DOC" | "DOCX";
  extractionStatus: "OK" | "Needs OCR / manual review";
  convertedDocx: string | null;
  customer: string | null;
  salesOrder: string | null;
  purchaseOrder: string | null;
  jobOrProject: string | null;
  location: string | null;
  equipment: string | null;
  /** Source of truth for the part ↔ serial relationship. May be empty on
   *  older records ingested before this field existed. */
  lineItems: LineItem[];
  partNumbers: PartEntry[];
  serials: string[];
  /** Document-level lot/batch/expiration/cure-date note (e.g. from a footer
   *  note applying to the whole certificate, not a specific part). NOT
   *  merged into lineItems[*] — display separately as a document-wide note. */
  docLotBatchNumber: string | null;
  docExpirationDate: string | null;
  docCureDate: string | null;
  certificateDate: string | null;
  testedDate: string | null;
  /** Certificate-level compliance statement (e.g. "API 6A, NACE MR0175") and
   *  who signed/authorized the certificate — distinct from a line item's
   *  per-part "specifications" (ratings/pressure/temperature block). */
  applicableSpecs: string | null;
  authorizedSignatory: string | null;
  signatoryTitle: string | null;
  lifecycleDate: string | null;
  recertificationDue: string | null;
  ageMonths: number | null;
  monthsToRecert: number | null;
  daysToRecert: number | null;
  status: string;
  priority: "High" | "Low" | "Manual review";
  invoiceBasis: string | null;
  recommendation: string;
  confidence: "High" | "Low";
  notes: string | null;
  textPreview: string | null;
  blobUrl: string | null;
  humanReviewed?: boolean;
};

/** Collapse duplicate part numbers, summing quantities and keeping the
 *  first non-empty description. Preserves first-seen order. */
export function dedupePartEntries(parts: PartEntry[]): PartEntry[] {
  const agg = new Map<string, PartEntry>();
  const order: string[] = [];
  for (const p of parts) {
    if (!p.number) continue;
    const existing = agg.get(p.number);
    if (!existing) {
      agg.set(p.number, { number: p.number, description: p.description, qty: p.qty });
      order.push(p.number);
    } else {
      if (p.qty != null) existing.qty = (existing.qty ?? 0) + p.qty;
      if (!existing.description && p.description) existing.description = p.description;
    }
  }
  return order.map((k) => agg.get(k)!);
}

/** Group flat serials under the part number they relate to.
 *  When lineItems are present we use the row relationship directly.
 *  Otherwise we group everything as "Unattributed". */
export type PartGroup = {
  part: PartEntry;
  serials: string[];
  lotBatchNumbers: string[];
  expirationDate: string | null;
  soLotBatchExp: string | null;
  specifications: string | null;
  invoiceNumber: string | null;
  workOrder: string | null;
};

/** Matches placeholder "no data" markers some CoC templates print literally
 *  in a table cell (e.g. "N/A", "None", "-") instead of leaving it blank.
 *  These aren't real lot/batch/expiration values, so a column full of them
 *  is noise, not information — treated the same as an empty cell when
 *  deciding what to display. */
const NA_PLACEHOLDER_RE = /^(n\.?\/?a\.?|none|null|not applicable|-|—)$/i;

function isMeaningfulValue(v: string | null | undefined): v is string {
  if (!v) return false;
  const trimmed = v.trim();
  return trimmed.length > 0 && !NA_PLACEHOLDER_RE.test(trimmed);
}

export function groupSerialsByPart(rec: Recommendation): {
  groups: PartGroup[];
  unattributedSerials: string[];
} {
  if (rec.lineItems && rec.lineItems.length > 0) {
    // Build groups keyed by partNumber, summing qty and merging serials in order.
    const map = new Map<string, PartGroup>();
    const order: string[] = [];
    for (const li of rec.lineItems) {
      if (!li.partNumber) continue;
      const key = li.partNumber;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          part: { number: li.partNumber, description: li.description, qty: li.qty },
          serials: [...li.serials],
          lotBatchNumbers: li.lotBatchNumbers.filter(isMeaningfulValue),
          expirationDate: isMeaningfulValue(li.expirationDate) ? li.expirationDate : null,
          soLotBatchExp: isMeaningfulValue(li.soLotBatchExp) ? li.soLotBatchExp : null,
          specifications: li.specifications,
          invoiceNumber: isMeaningfulValue(li.invoiceNumber) ? li.invoiceNumber : null,
          workOrder: isMeaningfulValue(li.workOrder) ? li.workOrder : null,
        });
        order.push(key);
      } else {
        if (li.qty != null) existing.part.qty = (existing.part.qty ?? 0) + li.qty;
        if (!existing.part.description && li.description)
          existing.part.description = li.description;
        for (const s of li.serials) {
          if (s && !existing.serials.includes(s)) existing.serials.push(s);
        }
        for (const lb of li.lotBatchNumbers) {
          if (isMeaningfulValue(lb) && !existing.lotBatchNumbers.includes(lb)) existing.lotBatchNumbers.push(lb);
        }
        if (!existing.expirationDate && isMeaningfulValue(li.expirationDate))
          existing.expirationDate = li.expirationDate;
        if (!existing.soLotBatchExp && isMeaningfulValue(li.soLotBatchExp))
          existing.soLotBatchExp = li.soLotBatchExp;
        if (!existing.specifications && li.specifications)
          existing.specifications = li.specifications;
        if (!existing.invoiceNumber && isMeaningfulValue(li.invoiceNumber))
          existing.invoiceNumber = li.invoiceNumber;
        if (!existing.workOrder && isMeaningfulValue(li.workOrder))
          existing.workOrder = li.workOrder;
      }
    }
    const groups = order.map((k) => map.get(k)!);
    const attributed = new Set<string>();
    for (const g of groups) for (const s of g.serials) attributed.add(s);
    const unattributedSerials = rec.serials.filter((s) => !attributed.has(s));
    // Also include line items that had no partNumber but had serials.
    const orphanSerials: string[] = [];
    for (const li of rec.lineItems) {
      if (li.partNumber) continue;
      for (const s of li.serials)
        if (!attributed.has(s) && !orphanSerials.includes(s)) orphanSerials.push(s);
    }
    for (const s of orphanSerials)
      if (!unattributedSerials.includes(s)) unattributedSerials.push(s);
    return { groups, unattributedSerials };
  }

  // No lineItems: dedup the flat partNumbers; all serials become unattributed.
  const groups = dedupePartEntries(rec.partNumbers).map((p) => ({
    part: p,
    serials: [] as string[],
    lotBatchNumbers: [] as string[],
    expirationDate: null as string | null,
    soLotBatchExp: null as string | null,
    specifications: null as string | null,
    invoiceNumber: null as string | null,
    workOrder: null as string | null,
  }));
  return { groups, unattributedSerials: [...rec.serials] };
}

/** Extract unique part descriptions from partNumbers, falling back to rec.equipment if empty. */
export function getEquipmentNames(rec: {
  partNumbers?: PartEntry[];
  equipment?: string | null;
}): string[] {
  const equipments = Array.from(
    new Set(
      rec.partNumbers
        ? rec.partNumbers
            .map((p) => p.description?.trim())
            .filter(Boolean) as string[]
        : []
    )
  );
  if (equipments.length > 0) {
    return equipments;
  }
  if (rec.equipment) {
    return rec.equipment
      .split(/[,;]/)
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return [];
}

/** Human-readable recertification countdown/overdue label.
 *
 * `monthsToRecert` is coarse (whole calendar months), so anything due within
 * the current month rounds down to 0 and reads as "in 0 mo" / "0 mo overdue"
 * — which looks like nothing is actually happening even when the date is
 * only days away. When the month count is 0, fall back to the exact
 * day-level `daysToRecert` field instead.
 */
export function formatRecertCountdown(rec: {
  monthsToRecert: number | null;
  daysToRecert?: number | null;
}): string {
  const { monthsToRecert, daysToRecert } = rec;
  if (monthsToRecert === null) return "—";

  if (monthsToRecert === 0 && daysToRecert != null) {
    if (daysToRecert < 0) {
      const d = Math.abs(daysToRecert);
      return `${d} day${d !== 1 ? "s" : ""} overdue`;
    }
    if (daysToRecert === 0) return "due today";
    return `in ${daysToRecert} day${daysToRecert !== 1 ? "s" : ""}`;
  }

  if (monthsToRecert < 0) {
    const m = Math.abs(monthsToRecert);
    return `${m} mo overdue`;
  }
  return `in ${monthsToRecert} mo`;
}

/** Sentence-style variant of {@link formatRecertCountdown}, e.g. for banners:
 * "Overdue by 12 days", "Due in 5 days", "Due today", "Due in 3 months". */
export function formatRecertUrgencyPhrase(rec: {
  monthsToRecert: number | null;
  daysToRecert?: number | null;
}): string {
  const { monthsToRecert, daysToRecert } = rec;
  if (monthsToRecert === null) return "Due soon";

  if (monthsToRecert === 0 && daysToRecert != null) {
    if (daysToRecert < 0) {
      const d = Math.abs(daysToRecert);
      return `Overdue by ${d} day${d !== 1 ? "s" : ""}`;
    }
    if (daysToRecert === 0) return "Due today";
    return `Due in ${daysToRecert} day${daysToRecert !== 1 ? "s" : ""}`;
  }

  if (monthsToRecert < 0) {
    const m = Math.abs(monthsToRecert);
    return `Overdue by ${m} month${m !== 1 ? "s" : ""}`;
  }
  return `Due in ${monthsToRecert} month${monthsToRecert !== 1 ? "s" : ""}`;
}

