"""Users router — allows Admin to manage users and roles."""
from __future__ import annotations

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Request
from pydantic import BaseModel
from firebase_admin import auth, firestore

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


@router.get("/users", response_model=List[UserResponse])
async def list_users():
    """List all registered users from the Firestore 'users' collection."""
    try:
        db = firestore.client()
        docs = db.collection("users").stream()
        users: list[UserResponse] = []
        for doc in docs:
            data = doc.to_dict()
            users.append(
                UserResponse(
                    uid=doc.id,
                    email=data.get("email"),
                    displayName=data.get("displayName"),
                    role=data.get("role", "Uploader"),
                )
            )
        return users
    except Exception as e:
        logger.exception("Failed to list users")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list users: {e}",
        )


@router.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate, request: Request):
    """Create a new user in Firebase Auth and save their profile/role in Firestore."""
    try:
        # 1. Create the user in Firebase Auth
        fb_user = auth.create_user(
            email=user.email,
            password=user.password,
            display_name=user.displayName,
        )

        # 2. Store their profile details in the Firestore 'users' collection
        db = firestore.client()
        db.collection("users").document(fb_user.uid).set(
            {
                "email": user.email,
                "displayName": user.displayName,
                "role": user.role,
            }
        )

        logger.info("Created user %s with role %s", fb_user.uid, user.role)
        
        # Log activity
        from store import log_activity
        log_activity(
            request=request,
            action="CREATE_USER",
            description=f"Registered new user credentials: {user.displayName} ({user.role})",
            details={"user_email": user.email, "user_name": user.displayName, "user_role": user.role}
        )
        
        return UserResponse(
            uid=fb_user.uid,
            email=user.email,
            displayName=user.displayName,
            role=user.role,
        )
    except Exception as e:
        logger.exception("Failed to create user")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/users/role/{uid}", response_model=dict)
async def get_user_role(uid: str):
    """Retrieve the role for a specific user ID from the Firestore 'users' collection."""
    try:
        db = firestore.client()
        doc_ref = db.collection("users").document(uid)
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            return {"role": data.get("role", "Uploader")}
        else:
            return {"role": "Uploader"}
    except Exception as e:
        logger.exception("Failed to get user role for %s", uid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get user role: {e}",
        )


@router.delete("/users/{uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(uid: str, request: Request):
    """Delete a user from Firebase Auth and clean up their profile in Firestore."""
    try:
        # Get existing user details first for logging
        db = firestore.client()
        doc = db.collection("users").document(uid).get()
        user_name = "unknown"
        user_email = "unknown"
        if doc.exists:
            data = doc.to_dict()
            user_name = data.get("displayName", "unknown")
            user_email = data.get("email", "unknown")

        # 1. Delete from Firebase Auth
        auth.delete_user(uid)

        # 2. Delete the profile document in Firestore
        db.collection("users").document(uid).delete()

        logger.info("Deleted user %s", uid)
        
        # Log activity
        from store import log_activity
        log_activity(
            request=request,
            action="DELETE_USER",
            description=f"Deleted user credentials: {user_name} ({user_email})",
            details={"deleted_uid": uid, "user_name": user_name, "user_email": user_email}
        )
    except Exception as e:
        logger.exception("Failed to delete user %s", uid)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete user: {e}",
        )
