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
    serials: List[str] = Field(default_factory=list)


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
    certificateDate: Optional[str] = None
    testedDate: Optional[str] = None
    lifecycleDate: Optional[str] = None
    recertificationDue: Optional[str] = None
    ageMonths: Optional[int] = None
    monthsToRecert: Optional[int] = None
    status: str
    priority: Literal["High", "Low", "Manual review"]
    invoiceBasis: Optional[str] = None
    recommendation: str
    confidence: Literal["High", "Low"]
    notes: Optional[str] = None
    textPreview: Optional[str] = None
    blobUrl: Optional[str] = None
    humanReviewed: bool = False


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
    serials: Optional[List[str]] = None
    partNumbers: Optional[List[PartEntry]] = None
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


