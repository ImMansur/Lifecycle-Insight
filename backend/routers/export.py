"""Export router — generates formatted Excel reports from filtered records."""
from __future__ import annotations

import asyncio
import io
import logging
import re
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel

from services.excel_structurer import extract_extra_fields
from store import recommendation_store
from auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["export"], dependencies=[Depends(get_current_user)])


class ExportRequest(BaseModel):
    rec_ids: List[str]


# Same placeholder-marker rule used on the frontend (wom-data.ts
# isMeaningfulValue): a cell that literally just says "N/A" / "None" / "-" is
# not real data and shouldn't be surfaced as if it were.
_NA_PLACEHOLDER_RE = re.compile(r"^(n\.?/?a\.?|none|null|not applicable|-|\u2014)$", re.IGNORECASE)


def _is_meaningful(v) -> bool:
    if not v:
        return False
    v = str(v).strip()
    return bool(v) and not _NA_PLACEHOLDER_RE.match(v)


def _fmt_equipment(row: dict) -> str:
    """Equipment should never be blank in the sheet. Falls back to a
    deterministic summary of the extracted line items instead of leaving the
    reader with nothing, when the certificate has no single top-level
    assembly name (e.g. a plain component/replacement-parts list)."""
    equip = row.get("equipment")
    if equip:
        return equip
    line_items = row.get("lineItems") or []
    if len(line_items) > 1:
        return f"Multiple Components ({len(line_items)})"
    if len(line_items) == 1:
        desc = (line_items[0] or {}).get("description")
        if desc:
            return desc
        return "1 Line Item"
    if row.get("partNumbers"):
        return "Various Replacement Parts"
    return ""


def _extracted_line_items_count(row: dict) -> int:
    """Deterministic count of rows actually grouped by the extractor — NOT
    the same thing as an item-numbering scheme printed on the source
    certificate (e.g. a cert may label its rows "Items 1-12" while our
    extractor grouped them into fewer structured lineItems). Column is
    labeled "Extracted Line Items" precisely to avoid that ambiguity."""
    line_items = row.get("lineItems") or []
    if line_items:
        return len(line_items)
    return len(row.get("partNumbers") or [])


def _fmt_metadata(row: dict) -> str:
    """Batch/cure/expiry/invoice/work-order metadata, attributed per-part
    where the source stated it per-row, plus a separately-labeled
    document-wide note when the certificate only states batch/expiry/cure
    once in a footer — never silently merged into a specific part's data
    (mirrors the per-row vs. document-level distinction enforced in
    openai_service.py)."""
    lines: list[str] = []
    for li in row.get("lineItems") or []:
        if not isinstance(li, dict):
            continue
        part = li.get("partNumber") or li.get("description") or "?"
        bits: list[str] = []
        lot = [x for x in (li.get("lotBatchNumbers") or []) if _is_meaningful(x)]
        if lot:
            bits.append(f"batch {', '.join(lot)}")
        if _is_meaningful(li.get("expirationDate")):
            bits.append(f"exp {li['expirationDate']}")
        if _is_meaningful(li.get("soLotBatchExp")):
            bits.append(li["soLotBatchExp"])
        if _is_meaningful(li.get("invoiceNumber")):
            bits.append(f"invoice {li['invoiceNumber']}")
        if _is_meaningful(li.get("workOrder")):
            bits.append(f"W.O. {li['workOrder']}")
        if bits:
            lines.append(f"{part}: " + "; ".join(bits))

    doc_bits: list[str] = []
    if _is_meaningful(row.get("docLotBatchNumber")):
        doc_bits.append(f"batch {row['docLotBatchNumber']}")
    if _is_meaningful(row.get("docExpirationDate")):
        doc_bits.append(f"exp {row['docExpirationDate']}")
    if _is_meaningful(row.get("docCureDate")):
        doc_bits.append(f"cure {row['docCureDate']}")
    if doc_bits:
        lines.append("Document-wide: " + "; ".join(doc_bits))

    return "\n".join(lines)


# ── openpyxl helpers ──────────────────────────────────────────────────────────

def _make_workbook(rows: list[dict]) -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "WOM Records"

    # ── Column definitions ──────────────────────────────────────────────────
    columns = [
        # Standard fields
        ("Priority",            18),
        ("Customer",            28),
        ("Sales Order",         16),
        ("Purchase Order",      18),
        ("Job / Project",       20),
        ("Location",            20),
        ("Equipment",           32),
        ("Part Numbers",        36),
        ("Identifiers",         28),
        ("Metadata (Batch/Expiry/Invoice/W.O.)", 34),
        ("Certificate Date",    18),
        ("Tested Date",         16),
        ("Recert. Due",         16),
        ("Age (Months)",        14),
        ("Months to Recert",    16),
        ("Status",              18),
        ("Confidence",          14),
        ("Recommendation",      50),
        ("Notes",               30),
        ("Source File",         30),
        # Excel-only extra fields
        ("Document Type",       22),
        ("Issuer",              28),
        ("Address",             32),
        ("Phone",               18),
        ("Fax",                 18),
        ("Applicable Specs",    28),
        ("Authorized Signatory",24),
        ("Signatory Title",     22),
        ("Extracted Line Items", 16),
    ]

    # ── Header row style ────────────────────────────────────────────────────
    HEADER_FILL   = PatternFill("solid", fgColor="1B3A6B")
    HEADER_FONT   = Font(color="FFFFFF", bold=True, size=10)
    EXTRA_FILL    = PatternFill("solid", fgColor="2E6DB4")
    CENTER        = Alignment(horizontal="center", vertical="center", wrap_text=True)
    LEFT          = Alignment(horizontal="left",   vertical="center", wrap_text=True)
    THIN_SIDE     = Side(style="thin", color="DDDDDD")
    THIN_BORDER   = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=THIN_SIDE)

    # Column header labels
    std_count = 20  # first 20 are standard fields

    for col_idx, (label, width) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.fill = HEADER_FILL if col_idx <= std_count else EXTRA_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER
        cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 30

    # ── Priority colour palette ─────────────────────────────────────────────
    PRIORITY_FILLS = {
        "High":          PatternFill("solid", fgColor="FFE0E0"),
        "Medium":        PatternFill("solid", fgColor="FFF3CD"),
        "Low":           PatternFill("solid", fgColor="E8F5E9"),
        "Manual review": PatternFill("solid", fgColor="F3F3F3"),
    }
    STATUS_FILLS = {
        "overdue":      PatternFill("solid", fgColor="FFD6D6"),
        "due-soon":     PatternFill("solid", fgColor="FFF0CC"),
        "active":       PatternFill("solid", fgColor="D6ECD2"),
        "new":          PatternFill("solid", fgColor="D6E8F7"),
    }

    # ── Data rows ───────────────────────────────────────────────────────────
    for r_idx, row in enumerate(rows, start=2):
        priority = row.get("priority") or ""
        status   = (row.get("status") or "").lower()

        row_fill   = PRIORITY_FILLS.get(priority)

        def _fmt_parts(parts) -> str:
            if not parts:
                return ""
            out = []
            for p in parts:
                if isinstance(p, dict):
                    num = p.get("number") or ""
                    desc = p.get("description") or ""
                    qty  = p.get("qty")
                    entry = num
                    if desc:
                        entry += f" – {desc}"
                    if qty:
                        entry += f" (qty {qty})"
                    out.append(entry)
                else:
                    out.append(str(p))
            return "\n".join(out)

        def _fmt_list(items) -> str:
            if not items:
                return ""
            if isinstance(items, list):
                return ", ".join(str(i) for i in items)
            return str(items)

        values = [
            priority,
            row.get("customer") or "",
            row.get("salesOrder") or "",
            row.get("purchaseOrder") or "",
            row.get("jobOrProject") or "",
            row.get("location") or "",
            _fmt_equipment(row),
            _fmt_parts(row.get("partNumbers")),
            _fmt_list(row.get("serials")),
            _fmt_metadata(row),
            row.get("certificateDate") or "",
            row.get("testedDate") or "",
            row.get("recertificationDue") or "",
            row.get("ageMonths") or "",
            row.get("monthsToRecert") or "",
            row.get("status") or "",
            row.get("confidence") or "",
            row.get("recommendation") or "",
            row.get("notes") or "",
            row.get("sourceFile") or "",
            # Extra fields
            row.get("_extra", {}).get("documentType") or "",
            row.get("_extra", {}).get("issuer") or "",
            row.get("_extra", {}).get("address") or "",
            row.get("_extra", {}).get("phone") or "",
            row.get("_extra", {}).get("fax") or "",
            row.get("applicableSpecs") or "",
            row.get("authorizedSignatory") or "",
            row.get("signatoryTitle") or "",
            _extracted_line_items_count(row),
        ]

        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=r_idx, column=col_idx, value=value)
            cell.alignment = LEFT
            cell.border = THIN_BORDER
            if row_fill:
                cell.fill = row_fill

        ws.row_dimensions[r_idx].height = 40 if "\n" in str(values[7]) or "\n" in str(values[9]) else 20

    # ── Freeze header + auto-filter ─────────────────────────────────────────
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}1"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/excel")
async def export_excel(body: ExportRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Generate a formatted Excel report for the given recommendation IDs.
    Enriches each record with extra CoC fields via Azure OpenAI.
    """
    if not body.rec_ids:
        return Response(content=b"", status_code=400)

    # Fetch records from Firestore (fast, synchronous store)
    recs = []
    for rec_id in body.rec_ids:
        rec = recommendation_store.get(rec_id)
        if rec:
            recs.append(rec)

    if not recs:
        return Response(content=b"", status_code=404)

    # Run OpenAI extra-field extraction in parallel (max 5 concurrent)
    sem = asyncio.Semaphore(5)

    async def _extract(rec):
        async with sem:
            extra = await extract_extra_fields(rec.textPreview)
            d = rec.model_dump()
            d["_extra"] = extra
            return d

    rows = await asyncio.gather(*[_extract(r) for r in recs])

    # Generate Excel bytes
    try:
        excel_bytes = _make_workbook(list(rows))
    except Exception as exc:
        logger.error("Excel generation failed: %s", exc)
        return Response(content=b"", status_code=500)

    # Log the export event
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="EXCEL_EXPORT",
        description=f"Exported {len(recs)} records to Excel sheet",
        details={"record_count": len(recs), "record_ids": body.rec_ids}
    )

    today = date.today().isoformat()
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="wom-records-{today}.xlsx"',
            "Content-Length": str(len(excel_bytes)),
        },
    )
