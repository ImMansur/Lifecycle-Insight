"""JWT-based authentication: password hashing, token issuing/verification, and
FastAPI dependencies for extracting + requiring the current authenticated user.

Replaces Firebase Auth. The JWT is delivered to the browser as an httpOnly
cookie (set by the /api/auth/login endpoint) so client-side JS never has
direct access to the token (mitigates XSS token theft). A Bearer
Authorization header is also accepted as a fallback (useful for non-browser
API clients / testing).
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status

logger = logging.getLogger(__name__)

JWT_SECRET = os.environ.get("JWT_SECRET_KEY")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_MINUTES = int(os.environ.get("JWT_EXPIRES_MINUTES", "480"))  # 8 hours
COOKIE_NAME = "wom_access_token"

# Vercel sets VERCEL=1 automatically in its serverless/runtime environment.
# Azure App Service sets WEBSITE_SITE_NAME automatically for every app.
# Locally none of these are set, so cookies aren't marked Secure (plain http://localhost works).
IS_PRODUCTION = bool(
    os.environ.get("VERCEL")
    or os.environ.get("WEBSITE_SITE_NAME")
    or os.environ.get("IS_PRODUCTION")
)


def hash_password(password: str) -> str:
    """Hash a plaintext password for storage. Never store plaintext passwords."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(uid: str, email: str, display_name: str, role: str) -> str:
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET_KEY env var not set — cannot issue tokens.")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": uid,
        "email": email,
        "name": display_name,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRES_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookie(response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        max_age=JWT_EXPIRES_MINUTES * 60,
        path="/",
    )


def clear_auth_cookie(response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


class CurrentUser:
    """Verified identity extracted from a valid JWT. NEVER trust client-supplied
    identity headers (x-user-*) — those are spoofable. This object is only
    ever constructed after cryptographic signature verification."""

    def __init__(self, uid: str, email: str, name: str, role: str):
        self.uid = uid
        self.email = email
        self.name = name
        self.role = role

    def to_dict(self) -> dict:
        return {"uid": self.uid, "email": self.email, "name": self.name, "role": self.role}


def _decode_token(token: str) -> CurrentUser:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )
    return CurrentUser(
        uid=payload.get("sub", ""),
        email=payload.get("email", ""),
        name=payload.get("name", ""),
        role=payload.get("role", "Uploader"),
    )


async def get_current_user(request: Request) -> CurrentUser:
    """FastAPI dependency: extract + verify the JWT (cookie first, then Bearer
    header). Raises 401 if missing/invalid/expired. Use this (directly or via
    a router's `dependencies=[Depends(get_current_user)]`) to require login."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return _decode_token(token)


async def get_current_user_optional(request: Request) -> Optional[CurrentUser]:
    """Like get_current_user, but returns None instead of raising when there's
    no valid session — useful for endpoints that behave differently for
    logged-in vs anonymous callers without hard-requiring auth."""
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


def require_roles(*roles: str):
    """FastAPI dependency factory: require the current user to have one of the
    given roles (in addition to just being authenticated)."""

    async def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if roles and user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return user

    return _checker
