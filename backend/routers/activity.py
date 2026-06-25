"""Activity router — exposes endpoints to fetch, log, and clear user activity logs."""
from __future__ import annotations

from typing import List
from fastapi import APIRouter, Request, status, HTTPException
from models import ActivityLog, ActivityLogEventRequest
from store import activity_log_store, log_activity

router = APIRouter(prefix="/api", tags=["activity"])


@router.get("/activity-logs", response_model=List[ActivityLog])
async def get_activity_logs():
    """Return all stored system activity logs."""
    return activity_log_store.all()


@router.post("/activity-logs/event", status_code=status.HTTP_204_NO_CONTENT)
async def log_client_event(payload: ActivityLogEventRequest, request: Request):
    """Allow the frontend to log client-only events like login or logout."""
    log_activity(
        request=request,
        action=payload.action,
        description=payload.description,
        details=payload.details
    )


@router.post("/activity-logs/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_activity_logs(request: Request):
    """Clear all stored activity logs in Firestore."""
    # Extra safety check: verify role header allows clearing
    role = request.headers.get("x-user-role", "Uploader")
    if role not in ["Developer", "System Administrator", "Fleet Manager"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers or administrators can purge activity logs."
        )
    
    # Log the purge action BEFORE clearing so we have a record, wait, if we clear it will be deleted, 
    # but we can clear and then add the purge log so there is always at least one log showing who cleared it!
    activity_log_store.clear()
    
    log_activity(
        request=request,
        action="PURGE_LOGS",
        description="Purged all system activity logs"
    )
