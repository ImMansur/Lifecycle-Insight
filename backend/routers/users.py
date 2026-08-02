"""Users router — login/logout/session endpoints plus Admin user management."""
from __future__ import annotations

import logging
import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Request, Response, Depends
from pydantic import BaseModel

from auth import (
    CurrentUser,
    create_access_token,
    clear_auth_cookie,
    get_current_user,
    hash_password,
    set_auth_cookie,
    verify_password,
)
from store import log_activity, user_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["users"])


class UserCreate(BaseModel):
    email: str
    password: str
    displayName: str
    role: str


class UserResponse(BaseModel):
    uid: str
    email: Optional[str] = None
    displayName: Optional[str] = None
    role: str


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    uid: str
    email: str
    displayName: str
    role: str


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, response: Response):
    """Verify credentials against the Cosmos-backed user store and issue a JWT cookie."""
    user = user_store.get_by_email(payload.email)
    if not user or not verify_password(payload.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(
        uid=user["id"],
        email=user["email"],
        display_name=user.get("displayName", ""),
        role=user.get("role", "Uploader"),
    )
    set_auth_cookie(response, token)

    return LoginResponse(
        uid=user["id"],
        email=user["email"],
        displayName=user.get("displayName", ""),
        role=user.get("role", "Uploader"),
    )


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    """Clear the auth cookie."""
    clear_auth_cookie(response)


@router.get("/auth/me", response_model=LoginResponse)
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    """Return the currently authenticated user, used to restore session on app load."""
    return LoginResponse(
        uid=current_user.uid,
        email=current_user.email,
        displayName=current_user.name,
        role=current_user.role,
    )


@router.get("/users/me/settings", response_model=dict)
async def get_my_settings(current_user: CurrentUser = Depends(get_current_user)):
    """Return the current user's saved dashboard preferences (e.g. upcomingSettings)."""
    user = user_store.get(current_user.uid)
    return (user or {}).get("upcomingSettings") or {}


@router.patch("/users/me/settings", response_model=dict)
async def update_my_settings(settings: dict, current_user: CurrentUser = Depends(get_current_user)):
    """Persist the current user's dashboard preferences, synced across devices."""
    user_store.update(current_user.uid, {"upcomingSettings": settings})
    return settings


# ---------------------------------------------------------------------------
# User management endpoints (Admin)
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[UserResponse])
async def list_users(current_user: CurrentUser = Depends(get_current_user)):
    """List all registered users from the Cosmos DB 'users' container.

    Fleet Managers cannot see System Administrator / Developer accounts — those
    are hidden, higher-privileged roles reserved for the dev team.
    """
    try:
        users = user_store.all()
        if current_user.role == "Fleet Manager":
            users = [u for u in users if u.get("role", "Uploader") not in ("System Administrator", "Developer")]
        return [
            UserResponse(
                uid=u["id"],
                email=u.get("email"),
                displayName=u.get("displayName"),
                role=u.get("role", "Uploader"),
            )
            for u in users
        ]
    except Exception as e:
        logger.exception("Failed to list users")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list users: {e}",
        )


@router.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate, request: Request, current_user: CurrentUser = Depends(get_current_user)):
    """Create a new user account in the Cosmos DB 'users' container."""
    try:
        if current_user.role == "Fleet Manager" and user.role in ("System Administrator", "Developer"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Fleet Managers cannot create System Administrator or Developer accounts",
            )

        if user_store.get_by_email(user.email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists")

        uid = str(uuid.uuid4())
        user_store.add(
            {
                "id": uid,
                "email": user.email,
                "displayName": user.displayName,
                "role": user.role,
                "passwordHash": hash_password(user.password),
            }
        )

        logger.info("Created user %s with role %s", uid, user.role)

        log_activity(
            current_user.to_dict(),
            action="CREATE_USER",
            description=f"Registered new user credentials: {user.displayName} ({user.role})",
            details={"user_email": user.email, "user_name": user.displayName, "user_role": user.role},
        )

        return UserResponse(
            uid=uid,
            email=user.email,
            displayName=user.displayName,
            role=user.role,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create user")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/users/role/{uid}", response_model=dict)
async def get_user_role(uid: str, current_user: CurrentUser = Depends(get_current_user)):
    """Retrieve the role for a specific user ID."""
    try:
        user = user_store.get(uid)
        if user:
            return {"role": user.get("role", "Uploader")}
        return {"role": "Uploader"}
    except Exception as e:
        logger.exception("Failed to get user role for %s", uid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get user role: {e}",
        )


VALID_ROLES = {"Fleet Manager", "Analysis", "Uploader", "System Administrator", "Developer"}


class UpdateRoleRequest(BaseModel):
    role: str


@router.patch("/users/{uid}/role", response_model=UserResponse)
async def update_user_role(uid: str, payload: UpdateRoleRequest, current_user: CurrentUser = Depends(get_current_user)):
    """Change a user's system role. Restricted to Fleet Manager / System Administrator."""
    if current_user.role not in ("Fleet Manager", "System Administrator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to change user roles")

    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid role: {payload.role}")

    user = user_store.get(uid)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if uid == current_user.uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot change your own role")

    if current_user.role == "Fleet Manager" and (
        payload.role in ("System Administrator", "Developer")
        or user.get("role", "Uploader") in ("System Administrator", "Developer")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Fleet Managers cannot assign or modify System Administrator / Developer roles",
        )

    old_role = user.get("role", "Uploader")
    user_store.update(uid, {"role": payload.role})

    logger.info("Updated role for user %s: %s -> %s", uid, old_role, payload.role)

    log_activity(
        current_user.to_dict(),
        action="UPDATE_USER_ROLE",
        description=f"Changed role for {user.get('displayName', 'unknown')}: {old_role} -> {payload.role}",
        details={"uid": uid, "old_role": old_role, "new_role": payload.role},
    )

    return UserResponse(
        uid=uid,
        email=user.get("email"),
        displayName=user.get("displayName"),
        role=payload.role,
    )


@router.delete("/users/{uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(uid: str, request: Request, current_user: CurrentUser = Depends(get_current_user)):
    """Delete a user account from the Cosmos DB 'users' container."""
    try:
        user = user_store.get(uid)
        user_name = user.get("displayName", "unknown") if user else "unknown"
        user_email = user.get("email", "unknown") if user else "unknown"

        if not user_store.remove(uid):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        logger.info("Deleted user %s", uid)

        log_activity(
            current_user.to_dict(),
            action="DELETE_USER",
            description=f"Deleted user credentials: {user_name} ({user_email})",
            details={"deleted_uid": uid, "user_name": user_name, "user_email": user_email},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete user %s", uid)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete user: {e}",
        )
