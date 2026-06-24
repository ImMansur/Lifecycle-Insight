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
  serials: string[];
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
  certificateDate: string | null;
  testedDate: string | null;
  lifecycleDate: string | null;
  recertificationDue: string | null;
  ageMonths: number | null;
  monthsToRecert: number | null;
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
};

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
        });
        order.push(key);
      } else {
        if (li.qty != null) existing.part.qty = (existing.part.qty ?? 0) + li.qty;
        if (!existing.part.description && li.description)
          existing.part.description = li.description;
        for (const s of li.serials) {
          if (s && !existing.serials.includes(s)) existing.serials.push(s);
        }
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

