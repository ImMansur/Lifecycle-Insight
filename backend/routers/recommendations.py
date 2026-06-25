"""Recommendations router — CRUD for stored recommendations."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models import Recommendation, RecommendationsResponse, Summary, PatchRecommendation
from store import recommendation_store, action_store
from services.openai_service import _compute_lifecycle_fields

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations():
    """Return all stored recommendations with a computed summary."""
    recs = recommendation_store.all()

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
async def delete_recommendation(rec_id: str, request: Request):
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
        request=request,
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
async def bulk_delete_recommendations(body: BulkDeleteRequest, request: Request):
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
            request=request,
            action="BULK_DELETE_RECOMMENDATIONS",
            description=f"Bulk deleted {len(deleted)} recommendations",
            details={"deleted_ids": deleted}
        )
    return {"deleted": len(deleted), "not_found": not_found}


@router.patch("/recommendations/{rec_id}", response_model=Recommendation)
async def patch_recommendation(rec_id: str, patch: PatchRecommendation, request: Request):
    """Manually correct extracted fields. Marks record as reviewed (OK / High confidence)."""
    fields = patch.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided.")

    # Serialize nested models (PartEntry list) for Firestore
    if "partNumbers" in fields:
        fields["partNumbers"] = [p.model_dump() for p in (patch.partNumbers or [])]

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

    for key in ("recertificationDue", "ageMonths", "monthsToRecert", "status", "priority", "lifecycleDate"):
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
        request=request,
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
