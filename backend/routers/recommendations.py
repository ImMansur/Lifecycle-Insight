"""Recommendations router — CRUD for stored recommendations."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models import Recommendation, RecommendationsResponse, Summary, PatchRecommendation, PartEntry, LineItem
from store import recommendation_store, action_store
from services.openai_service import _compute_lifecycle_fields, _build_recommendation_text
from auth import CurrentUser, get_current_user

router = APIRouter(prefix="/api", tags=["recommendations"], dependencies=[Depends(get_current_user)])


def _with_fresh_lifecycle(rec: Recommendation) -> Recommendation:
    """Recompute time-sensitive lifecycle fields (recertificationDue, ageMonths,
    monthsToRecert, status, priority, recommendation text) against *today's* date.

    These fields are derived purely from `certificateDate` + the current date, but
    were previously only computed once at ingestion (or manual edit) time and then
    stored as-is. As real time passes, a record that was "due soon" at ingestion
    silently becomes overdue without ever being recalculated, so the UI kept
    showing stale statuses/countdowns. Recomputing on every read keeps them
    accurate without mutating the stored record.
    """
    lifecycle = _compute_lifecycle_fields(rec.certificateDate)
    merged_data = rec.model_dump()
    rec_text, invoice_basis = _build_recommendation_text(rec.id, merged_data, lifecycle)

    updates = {
        "recertificationDue": lifecycle.get("recertificationDue"),
        "ageMonths": lifecycle.get("ageMonths"),
        "monthsToRecert": lifecycle.get("monthsToRecert"),
        "daysToRecert": lifecycle.get("daysToRecert"),
        "status": lifecycle.get("status"),
        "priority": lifecycle.get("priority"),
        "lifecycleDate": lifecycle.get("lifecycleDate"),
        "recommendation": rec_text,
    }
    if invoice_basis:
        updates["invoiceBasis"] = invoice_basis
    return rec.model_copy(update=updates)


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations():
    """Return all stored recommendations with a computed summary."""
    recs = [_with_fresh_lifecycle(r) for r in recommendation_store.all()]

    total = len(recs)
    ok = sum(1 for r in recs if r.extractionStatus == "OK")
    high = sum(1 for r in recs if r.priority == "High")
    needs_ocr = sum(1 for r in recs if r.extractionStatus == "Needs OCR / manual review")

    summary = Summary(
        asOf=date.today().isoformat(),
        filesProcessed=total,
        ok=ok,
        highPriority=high,
        needsOcr=needs_ocr,
    )

    return RecommendationsResponse(recommendations=recs, summary=summary)


@router.delete(
    "/recommendations/{rec_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_recommendation(rec_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Remove a recommendation by ID."""
    existing = recommendation_store.get(rec_id)
    removed = recommendation_store.remove(rec_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Recommendation '{rec_id}' not found.")
        
    actions = action_store.all()
    for action in actions:
        if action.linkedRecId == rec_id:
            action_store.remove(action.id)

    # Log activity
    from store import log_activity
    source_file = existing.sourceFile if existing else "unknown file"
    log_activity(
        request=current_user.to_dict(),
        action="DELETE_RECOMMENDATION",
        description=f"Deleted recommendation for {source_file}",
        details={"rec_id": rec_id, "source_file": source_file}
    )


class BulkDeleteRequest(BaseModel):
    ids: List[str]


@router.post(
    "/recommendations/bulk-delete",
    status_code=status.HTTP_200_OK,
)
async def bulk_delete_recommendations(body: BulkDeleteRequest, current_user: CurrentUser = Depends(get_current_user)):
    """Remove multiple recommendations by ID. Returns counts of deleted and not-found IDs."""
    deleted: list[str] = []
    not_found: list[str] = []
    for rec_id in body.ids:
        existing = recommendation_store.get(rec_id)
        removed = recommendation_store.remove(rec_id)
        if removed:
            deleted.append(rec_id)
            actions = action_store.all()
            for action in actions:
                if action.linkedRecId == rec_id:
                    action_store.remove(action.id)
        else:
            not_found.append(rec_id)

    # Log activity
    if deleted:
        from store import log_activity
        log_activity(
            request=current_user.to_dict(),
            action="BULK_DELETE_RECOMMENDATIONS",
            description=f"Bulk deleted {len(deleted)} recommendations",
            details={"deleted_ids": deleted}
        )
    return {"deleted": len(deleted), "not_found": not_found}


@router.patch("/recommendations/{rec_id}", response_model=Recommendation)
async def patch_recommendation(rec_id: str, patch: PatchRecommendation, current_user: CurrentUser = Depends(get_current_user)):
    """Manually correct extracted fields. Marks record as reviewed (OK / High confidence)."""
    fields = patch.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided.")

    # Serialize nested models (PartEntry list) for Firestore
    if "partNumbers" in fields:
        fields["partNumbers"] = [p.model_dump() for p in (patch.partNumbers or [])]

    # lineItems is the source of truth for the part ↔ serial relationship.
    # When the admin edits it, re-derive the legacy flat partNumbers/serials
    # arrays from it (same logic used at ingestion time) so older screens
    # that still read those flat arrays stay in sync instead of showing
    # stale data next to the freshly-edited line items.
    if "lineItems" in fields:
        line_items = patch.lineItems or []
        fields["lineItems"] = [li.model_dump() for li in line_items]

        derived_parts: list[dict] = []
        seen_parts: set[str] = set()
        for li in line_items:
            if li.partNumber and li.partNumber not in seen_parts:
                derived_parts.append(
                    PartEntry(number=li.partNumber, description=li.description, qty=li.qty).model_dump()
                )
                seen_parts.add(li.partNumber)
        fields["partNumbers"] = derived_parts

        derived_serials: list[str] = []
        seen_serials: set[str] = set()
        for li in line_items:
            for s in li.serials:
                if s and s not in seen_serials:
                    derived_serials.append(s)
                    seen_serials.add(s)
        fields["serials"] = derived_serials

    # Mark as manually reviewed once admin saves corrections
    fields["extractionStatus"] = "OK"
    fields["confidence"] = "High"
    fields["humanReviewed"] = True

    # Recompute lifecycle and recommendation text based on updated/existing fields
    existing = recommendation_store.get(rec_id)
    cert_date = fields.get("certificateDate")
    if cert_date is None and existing:
        cert_date = existing.certificateDate

    lifecycle = _compute_lifecycle_fields(cert_date)
    from services.openai_service import _build_recommendation_text
    
    # Merge existing record with the incoming fields to get the full state
    existing_dump = existing.model_dump() if existing else {}
    merged_data = {**existing_dump, **fields}
    
    rec_text, invoice_basis = _build_recommendation_text(rec_id, merged_data, lifecycle)
    fields["recommendation"] = rec_text
    if invoice_basis:
        fields["invoiceBasis"] = invoice_basis

    for key in (
        "recertificationDue",
        "ageMonths",
        "monthsToRecert",
        "daysToRecert",
        "status",
        "priority",
        "lifecycleDate",
    ):
        fields[key] = lifecycle.get(key)

    success = recommendation_store.update(rec_id, fields)
    if not success:
        raise HTTPException(status_code=404, detail=f"Recommendation '{rec_id}' not found.")

    updated = recommendation_store.get(rec_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Could not retrieve updated record.")

    # Log activity
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="UPDATE_RECOMMENDATION",
        description=f"Updated fields for recommendation: {updated.sourceFile}",
        details={
            "rec_id": rec_id,
            "source_file": updated.sourceFile,
            "updated_fields": list(fields.keys())
        }
    )
    return updated


@router.get("/health")
async def health():
    return {"status": "ok"}


_MIME_TYPES = {
    "pdf":  "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc":  "application/msword",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls":  "application/vnd.ms-excel",
    "png":  "image/png",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
}


def _get_blob_client(filename: str):
    """Return an Azure BlobClient for *filename* in the 'ocr' container."""
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    if not conn_str:
        raise HTTPException(status_code=503, detail="Blob storage not configured.")
    from azure.storage.blob import BlobServiceClient
    service = BlobServiceClient.from_connection_string(conn_str)
    return service.get_container_client("ocr").get_blob_client(filename)


@router.get("/documents/{filename:path}/view")
async def view_document(filename: str):
    """Stream a blob from Azure Storage with Content-Disposition: inline so browsers render it."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = _MIME_TYPES.get(ext, "application/octet-stream")

    try:
        blob_client = _get_blob_client(filename)
        stream = blob_client.download_blob()
        data = stream.readall()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Document not found: {exc}")

    safe_name = filename.replace('"', '')
    return StreamingResponse(
        iter([data]),
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/documents/{filename:path}/url")
async def get_document_url(filename: str):
    """Return a short-lived public SAS URL — used by Office Online viewer for DOCX/DOC files."""
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    if not conn_str:
        raise HTTPException(status_code=503, detail="Blob storage not configured.")

    parts: dict[str, str] = {}
    for segment in conn_str.split(";"):
        if "=" in segment:
            k, v = segment.split("=", 1)
            parts[k] = v

    account_name = parts.get("AccountName")
    account_key = parts.get("AccountKey")
    if not account_name or not account_key:
        raise HTTPException(status_code=503, detail="Invalid storage connection string.")

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = _MIME_TYPES.get(ext, "application/octet-stream")

    try:
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions
        expiry = datetime.now(timezone.utc) + timedelta(hours=24)
        sas_token = generate_blob_sas(
            account_name=account_name,
            container_name="ocr",
            blob_name=filename,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
            content_type=content_type,
        )
        url = f"https://{account_name}.blob.core.windows.net/ocr/{quote(filename)}?{sas_token}"
        return {"url": url, "filename": filename}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not generate document URL: {exc}")
