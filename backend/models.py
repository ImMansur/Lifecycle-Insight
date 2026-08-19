from __future__ import annotations

from enum import Enum
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class PartEntry(BaseModel):
    number: str
    description: Optional[str] = None
    qty: Optional[int] = None


class LineItem(BaseModel):
    """One row from the CoC's equipment table.

    A CoC typically lists one or more line items. Each row groups the
    description, the part number, the quantity, and the serial(s) that
    belong specifically to that part — the relationship that is lost when
    you flatten everything into separate ``partNumbers`` and ``serials``
    arrays.
    """
    description: Optional[str] = None
    partNumber: Optional[str] = None
    qty: Optional[int] = None
    # TRUE unit serial numbers only (e.g. "EQUIPMENT SERIAL NO.", "SERIALIZATION").
    serials: List[str] = Field(default_factory=list)
    # Lot / batch numbers for this row, when the source shows them as their
    # OWN distinct column (distinct concept from a serial number).
    lotBatchNumbers: List[str] = Field(default_factory=list)
    # Expiration / cure-date string for this row, when the source shows it as
    # its own distinct column.
    expirationDate: Optional[str] = None
    # Some templates print S.O. / Lot & Batch / Expiration together as ONE
    # combined column (e.g. "23810 / 4249260-12 / 3Q17"). When the source
    # keeps them combined like this, we preserve the raw string as-is here
    # instead of guessing how to split it.
    soLotBatchExp: Optional[str] = None
    # Technical ratings/spec block (rated working pressure, design
    # temperature, NACE/sour-service compliance, H2S/CO2/chloride/pH limits,
    # etc.) that some templates print directly below the product description
    # inside the same Description cell. It's a visually/conceptually SEPARATE
    # block from the actual equipment description (a blank line separates
    # them in the source, and it spans its own wrapped table rows) — kept
    # here instead of being concatenated onto "description" so the equipment
    # name/description stays short and readable.
    specifications: Optional[str] = None
    # Invoice number this specific row/part is billed under, when the source
    # states it per-row (distinct from salesOrder/purchaseOrder, which are
    # document-level). Use null if not stated per-row.
    invoiceNumber: Optional[str] = None
    # Work order / W.O. reference for this specific row/part, when the
    # source states it per-row. Use null if not stated per-row.
    workOrder: Optional[str] = None


class Recommendation(BaseModel):
    id: str
    sourceFile: str
    sourceType: Literal["PDF", "DOC", "DOCX"]
    extractionStatus: Literal["OK", "Needs OCR / manual review"]
    convertedDocx: Optional[str] = None
    customer: Optional[str] = None
    salesOrder: Optional[str] = None
    purchaseOrder: Optional[str] = None
    jobOrProject: Optional[str] = None
    location: Optional[str] = None
    equipment: Optional[str] = None
    # Structured line items (description ↔ partNumber ↔ qty ↔ serials).
    # This is the source of truth for the part/serial relationship.
    lineItems: List[LineItem] = Field(default_factory=list)
    # Legacy flat arrays — kept populated (derived from lineItems) so older
    # screens (Equipment tab, filters, etc.) continue to work unchanged.
    partNumbers: List[PartEntry] = Field(default_factory=list)
    serials: List[str] = Field(default_factory=list)
    # Document-level lot/batch/expiration/cure-date, extracted from a footer
    # or summary note that applies to the whole certificate rather than one
    # row (e.g. "B# 191218, CD: 2018Q4, EXP: 2025Q4"). Used as a fallback for
    # line items that have no per-row value of their own.
    docLotBatchNumber: Optional[str] = None
    docExpirationDate: Optional[str] = None
    docCureDate: Optional[str] = None
    certificateDate: Optional[str] = None
    testedDate: Optional[str] = None
    # Certificate-level compliance statement (e.g. "API 6A, NACE MR0175") and
    # who signed/authorized the certificate — distinct from a line item's
    # per-part "specifications" (ratings/pressure/temperature block).
    applicableSpecs: Optional[str] = None
    authorizedSignatory: Optional[str] = None
    signatoryTitle: Optional[str] = None
    lifecycleDate: Optional[str] = None
    recertificationDue: Optional[str] = None
    ageMonths: Optional[int] = None
    monthsToRecert: Optional[int] = None
    daysToRecert: Optional[int] = None
    status: str
    priority: Literal["High", "Low", "Manual review"]
    invoiceBasis: Optional[str] = None
    recommendation: str
    confidence: Literal["High", "Low"]
    notes: Optional[str] = None
    textPreview: Optional[str] = None
    blobUrl: Optional[str] = None
    humanReviewed: bool = False
    createdAt: Optional[str] = None
    ts: Optional[int] = None



class Summary(BaseModel):
    inputFolder: str = "Uploaded via browser"
    asOf: str
    filesProcessed: int
    ok: int
    highPriority: int
    needsOcr: int


class RecommendationsResponse(BaseModel):
    recommendations: List[Recommendation]
    summary: Summary


class IngestResponse(BaseModel):
    processed: int
    recommendations: List[Recommendation]
    pendingDuplicates: List["PendingDuplicate"] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class PendingDuplicate(BaseModel):
    """A newly-extracted record whose business key already exists in the store.
    The new record is **not** saved until the admin confirms."""
    existingId: str
    existingFile: str
    existingCustomer: Optional[str] = None
    existingSalesOrder: Optional[str] = None
    existingCertificateDate: Optional[str] = None
    newRecommendation: Recommendation  # full extracted rec, NOT yet persisted


class ConfirmDuplicateItem(BaseModel):
    existingId: str
    newRecommendation: Recommendation


class ConfirmDuplicatesRequest(BaseModel):
    updates: List[ConfirmDuplicateItem] = Field(default_factory=list)


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    pending_review = "pending_review"


class Job(BaseModel):
    id: str
    filename: str
    blobName: str
    sourceType: Literal["PDF", "DOC", "DOCX"]
    status: JobStatus = JobStatus.pending
    createdAt: str
    updatedAt: str
    progress: int = 0
    processed: int = 0
    recommendationId: Optional[str] = None
    recommendations: List[Recommendation] = Field(default_factory=list)
    pendingDuplicates: List[PendingDuplicate] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    message: Optional[str] = None


class PatchRecommendation(BaseModel):
    customer: Optional[str] = None
    salesOrder: Optional[str] = None
    purchaseOrder: Optional[str] = None
    jobOrProject: Optional[str] = None
    location: Optional[str] = None
    equipment: Optional[str] = None
    certificateDate: Optional[str] = None
    testedDate: Optional[str] = None
    docLotBatchNumber: Optional[str] = None
    docExpirationDate: Optional[str] = None
    docCureDate: Optional[str] = None
    applicableSpecs: Optional[str] = None
    authorizedSignatory: Optional[str] = None
    signatoryTitle: Optional[str] = None
    serials: Optional[List[str]] = None
    partNumbers: Optional[List[PartEntry]] = None
    # Structured per-part rows (source of truth for the part ↔ serial
    # relationship). When provided, `partNumbers`/`serials` (legacy flat
    # arrays) are re-derived from this list server-side rather than trusted
    # as independently-submitted values, so the two never drift apart.
    lineItems: Optional[List[LineItem]] = None
    notes: Optional[str] = None
    priority: Optional[Literal["High", "Low", "Manual review"]] = None


# ─── Action Center ────────────────────────────────────────────────────────────

class ActionStatus(str, Enum):
    in_progress = "in_progress"
    closed = "closed"
    failed = "failed"


class ActionComment(BaseModel):
    id: str
    text: str
    author: str
    createdAt: str
    type: Literal["update", "ai_suggestion"] = "update"


class Action(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: ActionStatus = ActionStatus.in_progress
    linkedRecId: Optional[str] = None
    comments: List[ActionComment] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class CreateAction(BaseModel):
    title: str
    description: Optional[str] = None
    status: ActionStatus = ActionStatus.in_progress
    linkedRecId: Optional[str] = None


class PatchAction(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[ActionStatus] = None
    linkedRecId: Optional[str] = None


class AddComment(BaseModel):
    text: str
    author: str = "Admin"


class CompressionLog(BaseModel):
    id: str
    filename: str
    originalSize: int
    compressedSize: int
    savedSize: int
    bypassDi: bool
    pages: int
    storageSavings: float
    diSavings: float
    totalSavings: float
    timestamp: str


class CompressionLogsSummary(BaseModel):
    totalOriginalSize: int
    totalCompressedSize: int
    totalSavedSize: int
    totalStorageSavings: float
    totalDiSavings: float
    totalSavings: float
    fileCount: int


class CompressionLogsResponse(BaseModel):
    logs: List[CompressionLog]
    summary: CompressionLogsSummary


# ─── User Activity Logging ──────────────────────────────────────────────────

class ActivityLog(BaseModel):
    id: str
    userId: str
    userEmail: str
    userName: str
    userRole: str
    action: str
    description: str
    details: Optional[dict] = None
    timestamp: str


class ActivityLogEventRequest(BaseModel):
    action: str
    description: str
    details: Optional[dict] = None


