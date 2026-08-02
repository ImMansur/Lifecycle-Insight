"""Activity router — exposes endpoints to fetch, log, and clear user activity logs."""
from __future__ import annotations

from typing import List
from fastapi import APIRouter, Depends, Request, status, HTTPException
from models import ActivityLog, ActivityLogEventRequest
from store import activity_log_store, log_activity
from auth import CurrentUser, get_current_user

router = APIRouter(prefix="/api", tags=["activity"], dependencies=[Depends(get_current_user)])


@router.get("/activity-logs", response_model=List[ActivityLog])
async def get_activity_logs(current_user: CurrentUser = Depends(get_current_user)):
    """Return all stored system activity logs. Restricted to Developer / System Administrator."""
    if current_user.role not in ("Developer", "System Administrator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers or administrators can view activity logs.",
        )
    return activity_log_store.all()


@router.post("/activity-logs/event", status_code=status.HTTP_204_NO_CONTENT)
async def log_client_event(payload: ActivityLogEventRequest, current_user: CurrentUser = Depends(get_current_user)):
    """Allow the frontend to log client-only events like login or logout."""
    log_activity(
        request=current_user.to_dict(),
        action=payload.action,
        description=payload.description,
        details=payload.details
    )


@router.post("/activity-logs/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_activity_logs(current_user: CurrentUser = Depends(get_current_user)):
    """Clear all stored activity logs. Only privileged roles may purge logs."""
    # Verified role from the signed JWT — cannot be spoofed via headers.
    if current_user.role not in ["Developer", "System Administrator", "Fleet Manager"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only developers or administrators can purge activity logs."
        )
    
    # Log the purge action BEFORE clearing so we have a record, wait, if we clear it will be deleted, 
    # but we can clear and then add the purge log so there is always at least one log showing who cleared it!
    activity_log_store.clear()
    
    log_activity(
        request=current_user.to_dict(),
        action="PURGE_LOGS",
        description="Purged all system activity logs"
    )
