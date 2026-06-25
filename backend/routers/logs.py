"""Logs router — exposes endpoints to fetch compression & savings logs."""
from __future__ import annotations

from fastapi import APIRouter, status, Request
from models import CompressionLogsResponse, CompressionLogsSummary
from store import compression_log_store

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/compression-logs", response_model=CompressionLogsResponse)
async def get_compression_logs():
    """Return all stored compression and savings logs with a computed summary."""
    logs = compression_log_store.all()

    total_original = sum(l.originalSize for l in logs)
    total_compressed = sum(l.compressedSize for l in logs)
    total_saved = sum(l.savedSize for l in logs)
    
    total_storage = sum(l.storageSavings for l in logs)
    total_di = sum(l.diSavings for l in logs)
    total_savings = sum(l.totalSavings for l in logs)

    summary = CompressionLogsSummary(
        totalOriginalSize=total_original,
        totalCompressedSize=total_compressed,
        totalSavedSize=total_saved,
        totalStorageSavings=round(total_storage, 4),
        totalDiSavings=round(total_di, 4),
        totalSavings=round(total_savings, 4),
        fileCount=len(logs),
    )

    return CompressionLogsResponse(logs=logs, summary=summary)


@router.post("/compression-logs/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_compression_logs(request: Request):
    """Clear all compression logs in Firestore."""
    compression_log_store.clear()
    from store import log_activity
    log_activity(
        request=request,
        action="CLEAR_COMPRESSION_LOGS",
        description="Cleared all PDF compression & savings logs"
    )
