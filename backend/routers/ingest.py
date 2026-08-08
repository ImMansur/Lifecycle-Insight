"""Ingest router — accepts file uploads and processes them through the pipeline."""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import List

import tempfile
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status, BackgroundTasks, Response, Request
from pydantic import BaseModel

from models import (
    ConfirmDuplicatesRequest,
    IngestResponse,
    PendingDuplicate,
    Recommendation,
)
from services.document_intelligence import extract_text, extract_text_from_docx
from services.openai_service import process_document
from services.blob_storage import upload_file, generate_upload_sas, download_blob, stage_block, commit_blocks
from services.page_counter import count_document_pages
from store import recommendation_store, upload_progress_store_fs
from auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"], dependencies=[Depends(get_current_user)])

upload_progress_store: dict[str, dict] = {}

# Per-file progress: 0–18% = chunk upload, 18–100% = processing pipeline.
_UPLOAD_PHASE_MAX = 18


def _scale_pipeline_progress(raw: int) -> int:
    """Map internal pipeline steps (5–100) into 18–100 so progress never jumps backward after upload."""
    clamped = max(5, min(100, raw))
    span = 100 - _UPLOAD_PHASE_MAX
    return _UPLOAD_PHASE_MAX + int((clamped - 5) * span / (100 - 5))


def init_upload_progress(upload_id: str, filenames: list[str]) -> None:
    """Pre-register every file so overall progress is averaged across the full batch."""
    for filename in filenames:
        update_upload_progress(upload_id, filename, 0, "Queued...")


# PyMuPDF is not reliably thread-safe — serialize compression across concurrent batch tasks.
_compression_lock: "asyncio.Lock | None" = None


def _get_compression_lock():
    global _compression_lock
    if _compression_lock is None:
        import asyncio
        _compression_lock = asyncio.Lock()
    return _compression_lock

def update_upload_progress(upload_id: str | None, filename: str, progress: int, substatus: str):
    if not upload_id:
        return
    # limit size to prevent memory leak
    if len(upload_progress_store) > 100:
        # remove oldest entry
        oldest = next(iter(upload_progress_store))
        upload_progress_store.pop(oldest, None)

    if upload_id not in upload_progress_store:
        upload_progress_store[upload_id] = {
            "progress": 0,
            "status": "Processing documents...",
            "substatus": "",
            "files": {}
        }
    
    store = upload_progress_store[upload_id]
    prev_progress = store["files"].get(filename, {}).get("progress", 0)
    progress = max(prev_progress, progress)

    store["files"][filename] = {
        "progress": progress,
        "substatus": substatus
    }
    
    # Calculate overall progress
    files = store["files"]
    if files:
        overall = sum(f["progress"] for f in files.values()) // len(files)
        
        # Build status/substatus
        completed = sum(1 for f in files.values() if f["progress"] >= 100)
        total = len(files)
        store["status"] = f"Processed {completed} of {total} documents"
        
        active_substatuses = [f["substatus"] for f in files.values() if f["progress"] < 100]
        if active_substatuses:
            store["substatus"] = active_substatuses[0]
            store["progress"] = min(99, overall)
        else:
            # All individual files finished processing, but the background task is still
            # executing database writes and preparing the final response payload.
            # Cap progress at 98% until the orchestrator saves the final result.
            if store.get("result") is None:
                store["substatus"] = "Finalizing..."
                store["progress"] = 98
            else:
                store["substatus"] = "Completed"
                store["progress"] = 100

    upload_progress_store_fs.save(upload_id, store)


@router.get("/ingest/status/{upload_id}")
async def get_ingest_status(upload_id: str):
    stored = upload_progress_store_fs.get(upload_id)
    if stored:
        return stored
    return {
        "progress": 0,
        "status": "Initializing...",
        "substatus": "Preparing pipeline...",
    }


@router.delete("/ingest/status/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ingest_status(upload_id: str):
    """Clean up the upload progress file after retrieval."""
    upload_progress_store_fs.delete(upload_id)
    upload_progress_store.pop(upload_id, None)


class InitProgressRequest(BaseModel):
    upload_id: str
    filenames: list[str]


@router.post("/ingest/init-progress", status_code=status.HTTP_200_OK)
async def register_upload_progress(payload: InitProgressRequest):
    """Register all expected filenames before upload begins (used for multi-file Vercel uploads)."""
    init_upload_progress(payload.upload_id, payload.filenames)
    return {"registered": len(payload.filenames)}


@router.post("/validate-document", status_code=status.HTTP_200_OK)
async def validate_document(file: UploadFile = File(...)):
    """Check page count before upload — used by the frontend to block oversized documents early."""
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'.")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")

    pages = count_document_pages(file_bytes, ext)
    allowed = pages <= MAX_PAGES
    message = None if allowed else _page_limit_error(filename, pages).replace(" Skipping.", "")
    return {
        "filename": filename,
        "pages": pages,
        "maxPages": MAX_PAGES,
        "allowed": allowed,
        "message": message,
    }


def log_optimization_event(filename: str, original_size: int, compressed_size: int, bypass_di: bool, pages: int) -> None:
    from datetime import datetime, timezone
    import uuid
    from models import CompressionLog
    from store import compression_log_store

    saved_size = original_size - compressed_size if original_size > compressed_size else 0
    
    # 1. Storage savings: hot tier rate $0.03 / GB / month over 3-year standard lifecycle
    gb_saved = saved_size / (1024 * 1024 * 1024)
    storage_savings = round(gb_saved * 0.03 * 36, 6)

    # 2. Azure Document Intelligence savings:
    # If bypassed entirely (DOC/DOCX): pages * $0.01
    # If PDF original_size > 4MB but compressed <= 4MB, we avoided Standard tier.
    # Standard Tier charges $0.01 per page.
    # Otherwise, efficiency/bandwidth savings = $0.005 per MB compressed.
    di_savings = 0.0
    if bypass_di:
        di_savings = round(pages * 0.01, 4)
    elif original_size > 4 * 1024 * 1024 and compressed_size <= 4 * 1024 * 1024:
        # Avoided standard tier upgrade
        di_savings = round(pages * 0.01, 4)
    else:
        # Bandwidth & processing resource savings
        mb_saved = saved_size / (1024 * 1024)
        di_savings = round(mb_saved * 0.005, 4)

    total_savings = round(storage_savings + di_savings, 4)

    log_entry = CompressionLog(
        id=str(uuid.uuid4()),
        filename=filename,
        originalSize=original_size,
        compressedSize=compressed_size,
        savedSize=saved_size,
        bypassDi=bypass_di,
        pages=pages,
        storageSavings=storage_savings,
        diSavings=di_savings,
        totalSavings=total_savings,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    compression_log_store.add(log_entry)


ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_PAGES = int(os.environ.get("MAX_PAGES", os.environ.get("DI_MAX_PAGES", "30")))


def _page_limit_error(filename: str, pages: int) -> str:
    return f"{filename}: document has {pages} pages (maximum allowed is {MAX_PAGES}). Skipping."


def _check_page_limit(file_bytes: bytes, filename: str, ext: str) -> str | None:
    pages = count_document_pages(file_bytes, ext)
    if pages > MAX_PAGES:
        return _page_limit_error(filename, pages)
    return None


def _get_combination_keys(rec: Recommendation) -> set[tuple[str, str, str, str]]:
    cust = (rec.customer or "").strip().lower()
    so = (rec.salesOrder or "").strip().lower()
    cert = (rec.certificateDate or "").strip()
    if not cust or not so:
        return set()

    keys = set()
    # 1. Use lineItems if they exist
    if rec.lineItems:
        for item in rec.lineItems:
            pn = (item.partNumber or "").strip().lower()
            desc = (item.description or "").strip().lower()
            val = pn if pn else desc
            if val:
                keys.add((cust, so, cert, val))

    # 2. Fall back to flat arrays if no keys were generated from lineItems
    if not keys:
        for p in rec.partNumbers:
            pn = (p.number or "").strip().lower()
            desc = (p.description or "").strip().lower()
            val = pn if pn else desc
            if val:
                keys.add((cust, so, cert, val))

    # 3. Fall back to empty string for part/item if still empty
    if not keys:
        keys.add((cust, so, cert, ""))

    return keys


# Background task definitions
async def background_ingest_files(
    upload_id: str,
    temp_files: list[tuple[Path, str, str]],
    initial_errors: list[str],
    user_info: dict | None = None,
):
    try:
        results: list[Recommendation] = []
        errors: list[str] = list(initial_errors)
        pending: list[PendingDuplicate] = []

        all_existing = recommendation_store.all()
        existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
        for r in all_existing:
            cust = (r.customer or "").strip().lower()
            so = (r.salesOrder or "").strip().lower()
            cert = (r.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                if g_key not in existing_by_group:
                    existing_by_group[g_key] = []
                existing_by_group[g_key].append(r)

        # 1. Read files and delete temp files
        valid_files: list[tuple[bytes, str, str]] = []
        for temp_path, filename, ext in temp_files:
            try:
                if temp_path.exists():
                    file_bytes = temp_path.read_bytes()
                    temp_path.unlink()
                else:
                    file_bytes = b""
            except Exception as e:
                logger.error("Failed to read/delete temp file %s: %s", temp_path, e)
                file_bytes = b""
            
            if file_bytes:
                valid_files.append((file_bytes, filename, ext))
            else:
                errors.append(f"{filename}: failed to read temporary file.")

        # 2. Process concurrently (concurrency limit = 5)
        import asyncio
        semaphore = asyncio.Semaphore(5)

        async def sem_process(fb: bytes, fn: str, ext: str):
            async with semaphore:
                return await _extract_and_compress_one_file(fb, fn, None, upload_id, user_info)

        tasks = [sem_process(fb, fn, ext) for fb, fn, ext in valid_files]
        gather_results = await asyncio.gather(*tasks)

        # 3. Post-process recommendations
        for rec, err in gather_results:
            if err:
                errors.append(err)
                continue
            if not rec:
                continue

            existing = recommendation_store.get(rec.id)
            if existing is None:
                cust = (rec.customer or "").strip().lower()
                so = (rec.salesOrder or "").strip().lower()
                cert = (rec.certificateDate or "").strip()
                if cust and so:
                    g_key = (cust, so, cert)
                    candidates = existing_by_group.get(g_key, [])
                    new_keys = _get_combination_keys(rec)
                    if new_keys and candidates:
                        for r in candidates:
                            r_keys = _get_combination_keys(r)
                            if new_keys.issubset(r_keys):
                                existing = r
                                break

            if existing is not None:
                pending.append(PendingDuplicate(
                    existingId=existing.id,
                    existingFile=existing.sourceFile,
                    existingCustomer=existing.customer,
                    existingSalesOrder=existing.salesOrder,
                    existingCertificateDate=existing.certificateDate,
                    newRecommendation=rec,
                ))
                continue

            cust = (rec.customer or "").strip().lower()
            so = (rec.salesOrder or "").strip().lower()
            cert = (rec.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                if g_key not in existing_by_group:
                    existing_by_group[g_key] = []
                existing_by_group[g_key].append(rec)

            results.append(rec)
            recommendation_store.add(rec)

        response_data = {
            "processed": len(results),
            "recommendations": [r.model_dump() for r in results],
            "pendingDuplicates": [d.model_dump() for d in pending],
            "errors": errors,
        }

        if upload_id not in upload_progress_store:
            upload_progress_store[upload_id] = {
                "progress": 100,
                "status": "Completed",
                "substatus": "Completed",
                "files": {}
            }
        store = upload_progress_store[upload_id]
        store["progress"] = 100
        store["status"] = f"Processed {len(results)} of {len(valid_files)} documents"
        store["substatus"] = "Completed"
        store["result"] = response_data
        upload_progress_store_fs.save(upload_id, store)
    except Exception as exc:
        logger.exception("Error in background ingest files task")
        store = upload_progress_store.get(upload_id) or {"progress": 100, "files": {}}
        store["progress"] = 100
        store["status"] = "Failed"
        store["substatus"] = str(exc)
        store["result"] = {
            "processed": 0,
            "recommendations": [],
            "pendingDuplicates": [],
            "errors": [f"Processing failed: {exc}"],
        }
        upload_progress_store_fs.save(upload_id, store)


async def background_ingest_from_blob(
    upload_id: str,
    valid_downloads: list[tuple[bytes, str, str]],
    initial_errors: list[str],
    user_info: dict | None = None,
):
    try:
        results: list[Recommendation] = []
        errors: list[str] = list(initial_errors)
        pending: list[PendingDuplicate] = []

        all_existing = recommendation_store.all()
        existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
        for r in all_existing:
            cust = (r.customer or "").strip().lower()
            so = (r.salesOrder or "").strip().lower()
            cert = (r.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                if g_key not in existing_by_group:
                    existing_by_group[g_key] = []
                existing_by_group[g_key].append(r)

        # Process concurrently (concurrency limit = 5)
        import asyncio
        semaphore = asyncio.Semaphore(5)

        async def sem_process(file_bytes: bytes, filename: str, blob_url: str):
            async with semaphore:
                return await _extract_and_compress_one_file(file_bytes, filename, blob_url, upload_id, user_info)

        tasks = [sem_process(fb, fn, bu) for fb, fn, bu in valid_downloads]
        gather_results = await asyncio.gather(*tasks)

        # Post-process recommendations
        for rec, err in gather_results:
            if err:
                errors.append(err)
                continue
            if not rec:
                continue

            existing = recommendation_store.get(rec.id)
            if existing is None:
                cust = (rec.customer or "").strip().lower()
                so = (rec.salesOrder or "").strip().lower()
                cert = (rec.certificateDate or "").strip()
                if cust and so:
                    g_key = (cust, so, cert)
                    candidates = existing_by_group.get(g_key, [])
                    new_keys = _get_combination_keys(rec)
                    if new_keys and candidates:
                        for r in candidates:
                            r_keys = _get_combination_keys(r)
                            if new_keys.issubset(r_keys):
                                existing = r
                                break

            if existing is not None:
                pending.append(PendingDuplicate(
                    existingId=existing.id,
                    existingFile=existing.sourceFile,
                    existingCustomer=existing.customer,
                    existingSalesOrder=existing.salesOrder,
                    existingCertificateDate=existing.certificateDate,
                    newRecommendation=rec,
                ))
                continue

            cust = (rec.customer or "").strip().lower()
            so = (rec.salesOrder or "").strip().lower()
            cert = (rec.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                if g_key not in existing_by_group:
                    existing_by_group[g_key] = []
                existing_by_group[g_key].append(rec)

            results.append(rec)
            recommendation_store.add(rec)

        response_data = {
            "processed": len(results),
            "recommendations": [r.model_dump() for r in results],
            "pendingDuplicates": [d.model_dump() for d in pending],
            "errors": errors,
        }

        if upload_id not in upload_progress_store:
            upload_progress_store[upload_id] = {
                "progress": 100,
                "status": "Completed",
                "substatus": "Completed",
                "files": {}
            }
        store = upload_progress_store[upload_id]
        store["progress"] = 100
        store["status"] = f"Processed {len(results)} of {len(valid_downloads)} documents"
        store["substatus"] = "Completed"
        store["result"] = response_data
        upload_progress_store_fs.save(upload_id, store)
    except Exception as exc:
        logger.exception("Error in background ingest from blob task")
        store = upload_progress_store.get(upload_id) or {"progress": 100, "files": {}}
        store["progress"] = 100
        store["status"] = "Failed"
        store["substatus"] = str(exc)
        store["result"] = {
            "processed": 0,
            "recommendations": [],
            "pendingDuplicates": [],
            "errors": [f"Processing failed: {exc}"],
        }
        upload_progress_store_fs.save(upload_id, store)


async def background_process_chunk(
    upload_id: str,
    file_bytes: bytes,
    filename: str,
    blob_url: str | None,
    user_info: dict | None = None,
):
    try:
        all_existing = recommendation_store.all()
        existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
        for r in all_existing:
            cust = (r.customer or "").strip().lower()
            so = (r.salesOrder or "").strip().lower()
            cert = (r.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                if g_key not in existing_by_group:
                    existing_by_group[g_key] = []
                existing_by_group[g_key].append(r)

        rec, dup, err = await _process_one_file(file_bytes, filename, blob_url, existing_by_group, upload_id, user_info)
        
        # Load progress state from filesystem or local memory
        store = upload_progress_store_fs.get(upload_id) or upload_progress_store.get(upload_id)
        if not store:
            store = {
                "progress": 0,
                "status": "Processing documents...",
                "substatus": "",
                "files": {}
            }
        
        # Merge results to support multi-file chunk uploads
        existing_result = store.get("result") or {
            "processed": 0,
            "recommendations": [],
            "pendingDuplicates": [],
            "errors": []
        }
        
        merged_result = {
            "processed": existing_result.get("processed", 0) + (1 if rec else 0),
            "recommendations": existing_result.get("recommendations", []) + ([rec.model_dump()] if rec else []),
            "pendingDuplicates": existing_result.get("pendingDuplicates", []) + ([dup.model_dump()] if dup else []),
            "errors": existing_result.get("errors", []) + ([err] if err else []),
        }

        # Update this file's progress to 100%
        if "files" not in store:
            store["files"] = {}
        store["files"][filename] = {
            "progress": 100,
            "substatus": "Completed"
        }

        # Calculate overall progress across files
        files = store["files"]
        if files:
            overall = sum(f.get("progress", 0) for f in files.values()) // len(files)
            store["progress"] = overall
            completed = sum(1 for f in files.values() if f.get("progress", 0) >= 100)
            total = len(files)
            store["status"] = f"Processed {completed} of {total} documents"
            active_substatuses = [f.get("substatus", "") for f in files.values() if f.get("progress", 0) < 100]
            store["substatus"] = active_substatuses[0] if active_substatuses else "Completed"
        else:
            store["progress"] = 100
            store["status"] = "Completed"
            store["substatus"] = "Completed"

        store["result"] = merged_result
        upload_progress_store[upload_id] = store
        upload_progress_store_fs.save(upload_id, store)
    except Exception as exc:
        logger.exception("Error in background chunk process task")
        store = upload_progress_store_fs.get(upload_id) or upload_progress_store.get(upload_id) or {
            "progress": 100,
            "status": "Failed",
            "substatus": str(exc),
            "files": {}
        }
        if "files" not in store:
            store["files"] = {}
        store["files"][filename] = {
            "progress": 100,
            "substatus": f"Failed: {exc}"
        }

        existing_result = store.get("result") or {
            "processed": 0,
            "recommendations": [],
            "pendingDuplicates": [],
            "errors": []
        }
        
        merged_result = {
            "processed": existing_result.get("processed", 0),
            "recommendations": existing_result.get("recommendations", []),
            "pendingDuplicates": existing_result.get("pendingDuplicates", []),
            "errors": existing_result.get("errors", []) + [f"{filename}: processing failed — {exc}"],
        }

        # Calculate overall progress across files
        files = store["files"]
        if files:
            overall = sum(f.get("progress", 0) for f in files.values()) // len(files)
            store["progress"] = overall
            completed = sum(1 for f in files.values() if f.get("progress", 0) >= 100)
            total = len(files)
            store["status"] = f"Processed {completed} of {total} documents"
            active_substatuses = [f.get("substatus", "") for f in files.values() if f.get("progress", 0) < 100]
            store["substatus"] = active_substatuses[0] if active_substatuses else "Failed"
        else:
            store["progress"] = 100
            store["status"] = "Failed"
            store["substatus"] = str(exc)

        store["result"] = merged_result
        upload_progress_store[upload_id] = store
        upload_progress_store_fs.save(upload_id, store)


@router.post("/ingest", status_code=status.HTTP_200_OK)
async def ingest_files(
    response: Response,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_current_user),
    files: List[UploadFile] = File(...),
    upload_id: str | None = None,
):
    """
    Upload one or more CoC documents (PDF, DOC, DOCX).
    Each file is processed through Document Intelligence + Azure OpenAI
    and the resulting recommendations are returned and stored in memory.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    results: list[Recommendation] = []
    errors: list[str] = []
    pending: list[PendingDuplicate] = []

    all_existing = recommendation_store.all()
    existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
    for r in all_existing:
        cust = (r.customer or "").strip().lower()
        so = (r.salesOrder or "").strip().lower()
        cert = (r.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            if g_key not in existing_by_group:
                existing_by_group[g_key] = []
            existing_by_group[g_key].append(r)

    # 1. Read files and validate size sequentially to protect memory/limits
    total_batch_size = 0
    total_batch_pages = 0
    valid_files: list[tuple[bytes, str, str]] = []

    for upload in files:
        filename = upload.filename or "unknown"
        ext = Path(filename).suffix.lower()

        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{filename}: unsupported file type '{ext}'. Allowed: PDF, DOC, DOCX.")
            continue

        file_bytes = await upload.read()
        original_size = len(file_bytes)
        
        if total_batch_size + original_size > MAX_FILE_SIZE_BYTES:
            errors.append(f"{filename}: total upload size exceeded 10MB limit. Skipping.")
            continue
            
        if len(file_bytes) == 0:
            errors.append(f"{filename}: empty file.")
            continue

        pages = count_document_pages(file_bytes, ext)
        if total_batch_pages + pages > MAX_PAGES:
            errors.append(
                f"{filename}: adding this document would exceed the total limit of {MAX_PAGES} pages "
                f"(document has {pages} pages, current total is {total_batch_pages}). Skipping."
            )
            continue

        total_batch_pages += pages
        total_batch_size += original_size
        valid_files.append((file_bytes, filename, ext))

    user_info = current_user.to_dict()

    # Initialize progress for all files in the batch
    if upload_id:
        for _, filename, _ in valid_files:
            update_upload_progress(upload_id, filename, 0, "Queued...")

    if upload_id:
        # Save files to temp directory so background tasks can read them
        temp_dir = Path(tempfile.gettempdir()) / "wom_ingest_temp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        temp_files: list[tuple[Path, str, str]] = []
        for file_bytes, filename, ext in valid_files:
            temp_path = temp_dir / f"{uuid.uuid4()}{ext}"
            temp_path.write_bytes(file_bytes)
            temp_files.append((temp_path, filename, ext))

        background_tasks.add_task(
            background_ingest_files,
            upload_id,
            temp_files,
            errors,
            user_info
        )
        response.status_code = status.HTTP_202_ACCEPTED
        return {"status": "accepted", "upload_id": upload_id}

    # 2. Synchronous fallback (if no upload_id provided)
    # Process valid files concurrently (concurrency limit = 5)
    import asyncio
    semaphore = asyncio.Semaphore(5)

    async def sem_process(file_bytes: bytes, filename: str, ext: str):
        async with semaphore:
            return await _extract_and_compress_one_file(file_bytes, filename, None, upload_id, user_info)

    tasks = [sem_process(fb, fn, ext) for fb, fn, ext in valid_files]
    gather_results = await asyncio.gather(*tasks)

    # 3. Post-process recommendations sequentially in memory to prevent duplicate checks race conditions
    for rec, err in gather_results:
        if err:
            errors.append(err)
            continue
        if not rec:
            continue

        existing = recommendation_store.get(rec.id)
        if existing is None:
            cust = (rec.customer or "").strip().lower()
            so = (rec.salesOrder or "").strip().lower()
            cert = (rec.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                candidates = existing_by_group.get(g_key, [])
                new_keys = _get_combination_keys(rec)
                if new_keys and candidates:
                    for r in candidates:
                        r_keys = _get_combination_keys(r)
                        if new_keys.issubset(r_keys):
                            existing = r
                            break

        if existing is not None:
            pending.append(PendingDuplicate(
                existingId=existing.id,
                existingFile=existing.sourceFile,
                existingCustomer=existing.customer,
                existingSalesOrder=existing.salesOrder,
                existingCertificateDate=existing.certificateDate,
                newRecommendation=rec,
            ))
            continue

        cust = (rec.customer or "").strip().lower()
        so = (rec.salesOrder or "").strip().lower()
        cert = (rec.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            if g_key not in existing_by_group:
                existing_by_group[g_key] = []
            existing_by_group[g_key].append(rec)

        results.append(rec)
        recommendation_store.add(rec)

    return IngestResponse(
        processed=len(results),
        recommendations=results,
        pendingDuplicates=pending,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Helpers shared by both ingest endpoints
# ---------------------------------------------------------------------------

async def _extract_and_compress_one_file(
    file_bytes: bytes,
    filename: str,
    blob_url: str | None,
    upload_id: str | None = None,
    user_info: dict | None = None,
) -> tuple[Recommendation | None, str | None]:
    """Runs PDF compression, storage uploading, and text extraction/AI recommendation."""
    import time
    start_time = time.time()
    
    update_upload_progress(upload_id, filename, _scale_pipeline_progress(5), "Starting processing...")
    ext = Path(filename).suffix.lower()
    source_type = ext.lstrip(".").upper()

    original_size = len(file_bytes)
    compressed_size = original_size
    pages = 0
    bypassed = False

    # Compress PDF if applicable
    if ext == ".pdf":
        update_upload_progress(upload_id, filename, _scale_pipeline_progress(15), "Compressing PDF document...")
        from services.pdf_compressor import compress_pdf_bytes
        import asyncio
        async with _get_compression_lock():
            compressed_bytes, pages = await asyncio.to_thread(
                compress_pdf_bytes, file_bytes, filename
            )
        if len(compressed_bytes) < len(file_bytes):
            file_bytes = compressed_bytes
            compressed_size = len(file_bytes)
            # Re-upload compressed version to Blob Storage
            try:
                update_upload_progress(upload_id, filename, _scale_pipeline_progress(25), "Uploading compressed PDF...")
                from services.blob_storage import upload_file
                upload_file(file_bytes, filename)
            except Exception as e:
                logger.warning("Failed to re-upload compressed PDF for %s: %s", filename, e)

    try:
        converted_docx_name: str | None = None
        update_upload_progress(upload_id, filename, _scale_pipeline_progress(35), "Extracting text layers (OCR)...")
        if ext in {".doc", ".docx"}:
            docx_text = extract_text_from_docx(file_bytes)
            if len(docx_text.strip()) >= 100:
                extracted_text = docx_text
                is_ocr_needed = False
                bypassed = True
                if ext == ".doc":
                    converted_docx_name = Path(filename).stem + ".docx"
            else:
                extracted_text, is_ocr_needed = await extract_text(file_bytes, filename)
        else:
            extracted_text, is_ocr_needed = await extract_text(file_bytes, filename)

        update_upload_progress(upload_id, filename, _scale_pipeline_progress(65), "Analyzing with OpenAI...")
        recommendation = await process_document(
            file_bytes=file_bytes,
            filename=filename,
            extracted_text=extracted_text,
            is_ocr_needed=is_ocr_needed,
            source_type=source_type,
        )
        recommendation.convertedDocx = converted_docx_name
        recommendation.blobUrl = blob_url

        if ext == ".pdf":
            log_optimization_event(filename, original_size, compressed_size, bypass_di=False, pages=pages)
        elif bypassed:
            est_pages = max(1, len(extracted_text) // 1500)
            log_optimization_event(filename, original_size, original_size, bypass_di=True, pages=est_pages)

        # Calculate duration
        duration = round(time.time() - start_time, 2)

        # Log activity
        ocr_status = "executed" if is_ocr_needed else "bypassed"
        num_pages = pages if ext == ".pdf" else (max(1, len(extracted_text) // 1500) if bypassed else pages)
        from store import log_activity
        log_activity(
            request=user_info,
            action="INGEST_FILE",
            description=f"Ingested file: {filename} ({num_pages} pages, OCR {ocr_status})",
            details={
                "filename": filename,
                "pages": num_pages,
                "ocr_status": ocr_status,
                "original_size": original_size,
                "compressed_size": compressed_size,
                "recommendation_id": recommendation.id,
                "customer": recommendation.customer,
                "sales_order": recommendation.salesOrder,
                "duration": duration
            }
        )

        update_upload_progress(upload_id, filename, 100, "Completed")
        return recommendation, None

    except Exception as exc:
        logger.exception("Unexpected error processing %s", filename)
        update_upload_progress(upload_id, filename, 100, "Failed")
        return None, f"{filename}: processing failed — {exc}"


async def _process_one_file(
    file_bytes: bytes,
    filename: str,
    blob_url: str | None,
    existing_by_group: dict[tuple[str, str, str], list[Recommendation]],
    upload_id: str | None = None,
    user_info: dict | None = None,
) -> tuple[Recommendation | None, PendingDuplicate | None, str | None]:
    """
    Run the full extraction→AI→dedup pipeline for a single file.

    Returns (recommendation, pending_duplicate, error_message).  Exactly one
    of the three will be non-None.
    """
    rec, err = await _extract_and_compress_one_file(file_bytes, filename, blob_url, upload_id, user_info)
    if err:
        return None, None, err
    if not rec:
        return None, None, f"{filename}: processing failed"

    existing = recommendation_store.get(rec.id)
    if existing is None:
        cust = (rec.customer or "").strip().lower()
        so = (rec.salesOrder or "").strip().lower()
        cert = (rec.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            candidates = existing_by_group.get(g_key, [])
            new_keys = _get_combination_keys(rec)
            if new_keys and candidates:
                for r in candidates:
                    r_keys = _get_combination_keys(r)
                    if new_keys.issubset(r_keys):
                        existing = r
                        break

    if existing is not None:
        return None, PendingDuplicate(
            existingId=existing.id,
            existingFile=existing.sourceFile,
            existingCustomer=existing.customer,
            existingSalesOrder=existing.salesOrder,
            existingCertificateDate=existing.certificateDate,
            newRecommendation=rec,
        ), None

    cust = (rec.customer or "").strip().lower()
    so = (rec.salesOrder or "").strip().lower()
    cert = (rec.certificateDate or "").strip()
    if cust and so:
        g_key = (cust, so, cert)
        if g_key not in existing_by_group:
            existing_by_group[g_key] = []
        existing_by_group[g_key].append(rec)

    recommendation_store.add(rec)
    return rec, None, None


# ---------------------------------------------------------------------------
# Chunked upload endpoint (used on Vercel to bypass the 4.5 MB body limit)
# ---------------------------------------------------------------------------

@router.post("/ingest-chunk", status_code=status.HTTP_200_OK)
async def ingest_chunk(
    response: Response,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_current_user),
    file: UploadFile = File(...),
    filename: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    upload_id: str | None = None,
):
    """
    Accept one chunk of a larger file upload.

    The browser slices the file into pieces that each fit under Vercel's 4.5 MB
    function body limit and POSTs them here.  Each chunk is staged as an Azure
    Blob block (server-side — no browser-to-Azure CORS required).  When the
    final chunk arrives the blocks are committed and the assembled file is run
    through the full extraction + AI pipeline.
    """
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'.")

    chunk_bytes = await file.read()
    if len(chunk_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty chunk received.")

    # Block IDs must be base64-encoded and all have the same length.
    block_id = base64.b64encode(f"{chunk_index:08d}".encode()).decode()

    ok = stage_block(filename, block_id, chunk_bytes)
    if not ok:
        raise HTTPException(
            status_code=503,
            detail="Blob storage unavailable — check AZURE_STORAGE_CONNECTION_STRING.",
        )

    # Intermediate chunk: acknowledge and wait for more.
    if chunk_index < total_chunks - 1:
        # Estimate upload progress of chunks
        if upload_id:
            pct = int(((chunk_index + 1) / total_chunks) * _UPLOAD_PHASE_MAX)
            update_upload_progress(upload_id, filename, max(1, pct), f"Uploading chunk {chunk_index + 1}/{total_chunks}...")
        return {"staged": True, "chunk_index": chunk_index, "total_chunks": total_chunks}

    # Final chunk: commit all staged blocks into one blob then process.
    if upload_id:
        update_upload_progress(upload_id, filename, _UPLOAD_PHASE_MAX, "Assembling document...")
    all_block_ids = [base64.b64encode(f"{i:08d}".encode()).decode() for i in range(total_chunks)]
    blob_url = commit_blocks(filename, all_block_ids)

    file_bytes = download_blob(filename)
    if file_bytes is None:
        raise HTTPException(status_code=503, detail="Could not download assembled file from blob storage.")

    page_err = _check_page_limit(file_bytes, filename, ext)
    if page_err:
        if upload_id:
            # Save error response in progress store
            if upload_id not in upload_progress_store:
                upload_progress_store[upload_id] = {"progress": 100, "files": {}}
            store = upload_progress_store[upload_id]
            store["progress"] = 100
            store["status"] = "Failed"
            store["substatus"] = page_err
            store["result"] = {
                "processed": 0,
                "recommendations": [],
                "pendingDuplicates": [],
                "errors": [page_err],
            }
            upload_progress_store_fs.save(upload_id, store)
            response.status_code = status.HTTP_202_ACCEPTED
            return {"status": "accepted", "upload_id": upload_id}
        else:
            return IngestResponse(processed=0, recommendations=[], pendingDuplicates=[], errors=[page_err])

    user_info = current_user.to_dict()

    if upload_id:
        background_tasks.add_task(
            background_process_chunk,
            upload_id,
            file_bytes,
            filename,
            blob_url,
            user_info
        )
        response.status_code = status.HTTP_202_ACCEPTED
        return {"status": "accepted", "upload_id": upload_id}

    # Synchronous fallback
    all_existing = recommendation_store.all()
    existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
    for r in all_existing:
        cust = (r.customer or "").strip().lower()
        so = (r.salesOrder or "").strip().lower()
        cert = (r.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            if g_key not in existing_by_group:
                existing_by_group[g_key] = []
            existing_by_group[g_key].append(r)

    rec, dup, err = await _process_one_file(file_bytes, filename, blob_url, existing_by_group, upload_id, user_info)

    return IngestResponse(
        processed=1 if rec else 0,
        recommendations=[rec] if rec else [],
        pendingDuplicates=[dup] if dup else [],
        errors=[err] if err else [],
    )


# ---------------------------------------------------------------------------
# SAS upload URL endpoint
# ---------------------------------------------------------------------------

@router.get("/upload-sas")
async def get_upload_sas(filename: str):
    """
    Return a short-lived Azure Blob SAS URL that allows the browser to PUT the
    file directly into blob storage — bypassing the Vercel function body limit.
    """
    sas_url = generate_upload_sas(filename)
    if not sas_url:
        raise HTTPException(
            status_code=503,
            detail="Blob storage SAS generation not available. Check AZURE_STORAGE_CONNECTION_STRING.",
        )
    return {"url": sas_url, "blobName": filename}


# ---------------------------------------------------------------------------
# Ingest-from-blob endpoint (used by the frontend after direct SAS upload)
# ---------------------------------------------------------------------------

@router.post("/ingest-from-blob", status_code=status.HTTP_200_OK)
async def ingest_from_blob(
    response: Response,
    background_tasks: BackgroundTasks,
    blob_names: list[str],
    current_user: CurrentUser = Depends(get_current_user),
    upload_id: str | None = None,
):
    """
    Process files that have already been uploaded directly to Azure Blob
    Storage (via SAS URL).  Accepts a JSON array of blob names.
    """
    if not blob_names:
        raise HTTPException(status_code=400, detail="No blob names provided.")

    results: list[Recommendation] = []
    errors: list[str] = []
    pending: list[PendingDuplicate] = []

    all_existing = recommendation_store.all()
    existing_by_group: dict[tuple[str, str, str], list[Recommendation]] = {}
    for r in all_existing:
        cust = (r.customer or "").strip().lower()
        so = (r.salesOrder or "").strip().lower()
        cert = (r.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            if g_key not in existing_by_group:
                existing_by_group[g_key] = []
            existing_by_group[g_key].append(r)

    # 1. Download and validate sizes sequentially
    total_batch_size = 0
    total_batch_pages = 0
    valid_downloads: list[tuple[bytes, str, str]] = []

    for blob_name in blob_names:
        ext = Path(blob_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{blob_name}: unsupported file type '{ext}'.")
            continue

        file_bytes = download_blob(blob_name)
        if file_bytes is None:
            errors.append(f"{blob_name}: could not download from blob storage.")
            continue
            
        original_size = len(file_bytes)
        if total_batch_size + original_size > MAX_FILE_SIZE_BYTES:
            errors.append(f"{blob_name}: total upload size exceeded 10MB limit. Skipping.")
            continue
            
        if len(file_bytes) == 0:
            errors.append(f"{blob_name}: empty file.")
            continue

        pages = count_document_pages(file_bytes, ext)
        if total_batch_pages + pages > MAX_PAGES:
            errors.append(
                f"{blob_name}: adding this document would exceed the total limit of {MAX_PAGES} pages "
                f"(document has {pages} pages, current total is {total_batch_pages}). Skipping."
            )
            continue

        total_batch_pages += pages
        total_batch_size += original_size
        blob_url = f"https://blob/{blob_name}"
        valid_downloads.append((file_bytes, blob_name, blob_url))

    user_info = current_user.to_dict()

    # Initialize progress for all files in the batch
    if upload_id:
        for _, filename, _ in valid_downloads:
            update_upload_progress(upload_id, filename, 0, "Queued...")

    if upload_id:
        background_tasks.add_task(
            background_ingest_from_blob,
            upload_id,
            valid_downloads,
            errors,
            user_info
        )
        response.status_code = status.HTTP_202_ACCEPTED
        return {"status": "accepted", "upload_id": upload_id}

    # Synchronous fallback
    # 2. Process concurrently (concurrency limit = 5)
    import asyncio
    semaphore = asyncio.Semaphore(5)

    async def sem_process(file_bytes: bytes, filename: str, blob_url: str):
        async with semaphore:
            return await _extract_and_compress_one_file(file_bytes, filename, blob_url, upload_id, user_info)

    tasks = [sem_process(fb, fn, bu) for fb, fn, bu in valid_downloads]
    gather_results = await asyncio.gather(*tasks)

    # 3. Post-process recommendations sequentially in memory
    for rec, err in gather_results:
        if err:
            errors.append(err)
            continue
        if not rec:
            continue

        existing = recommendation_store.get(rec.id)
        if existing is None:
            cust = (rec.customer or "").strip().lower()
            so = (rec.salesOrder or "").strip().lower()
            cert = (rec.certificateDate or "").strip()
            if cust and so:
                g_key = (cust, so, cert)
                candidates = existing_by_group.get(g_key, [])
                new_keys = _get_combination_keys(rec)
                if new_keys and candidates:
                    for r in candidates:
                        r_keys = _get_combination_keys(r)
                        if new_keys.issubset(r_keys):
                            existing = r
                            break

        if existing is not None:
            pending.append(PendingDuplicate(
                existingId=existing.id,
                existingFile=existing.sourceFile,
                existingCustomer=existing.customer,
                existingSalesOrder=existing.salesOrder,
                existingCertificateDate=existing.certificateDate,
                newRecommendation=rec,
            ))
            continue

        cust = (rec.customer or "").strip().lower()
        so = (rec.salesOrder or "").strip().lower()
        cert = (rec.certificateDate or "").strip()
        if cust and so:
            g_key = (cust, so, cert)
            if g_key not in existing_by_group:
                existing_by_group[g_key] = []
            existing_by_group[g_key].append(rec)

        results.append(rec)
        recommendation_store.add(rec)

    return IngestResponse(
        processed=len(results),
        recommendations=results,
        pendingDuplicates=pending,
        errors=errors,
    )


@router.post(
    "/ingest/confirm",
    response_model=IngestResponse,
    status_code=status.HTTP_200_OK,
)
async def confirm_ingest_duplicates(payload: ConfirmDuplicatesRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Apply duplicate-resolution decisions returned by ``POST /api/ingest``.

    For each item, the *new* recommendation **replaces** the existing one — the
    existing record's ID is preserved so any linked actions, comments, and
    notifications remain intact.

    Items the admin chose to cancel should simply be omitted from ``updates``.
    """
    applied: list[Recommendation] = []
    errors: list[str] = []

    for item in payload.updates:
        existing = recommendation_store.get(item.existingId)
        if existing is None:
            errors.append(f"{item.existingId}: existing record not found (already deleted?).")
            continue

        # Replace existing record's content but keep its ID
        merged = item.newRecommendation.model_copy(update={"id": item.existingId})
        recommendation_store.add(merged)  # `.add` uses .set() — overwrites by ID
        applied.append(merged)
        
        # Log duplicate confirmation
        from store import log_activity
        log_activity(
            request=current_user.to_dict(),
            action="CONFIRM_DUPLICATE",
            description=f"Confirmed duplicate and updated recommendation for {merged.sourceFile}",
            details={"rec_id": merged.id, "source_file": merged.sourceFile}
        )

    return IngestResponse(
        processed=len(applied),
        recommendations=applied,
        pendingDuplicates=[],
        errors=errors,
    )
