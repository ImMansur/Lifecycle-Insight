"""Action Center router — CRUD for work orders / action items + comments."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from models import Action, ActionComment, CreateAction, PatchAction, AddComment
from store import action_store, recommendation_store
from auth import CurrentUser, get_current_user

router = APIRouter(prefix="/api", tags=["actions"], dependencies=[Depends(get_current_user)])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Actions ──────────────────────────────────────────────────────────────────

@router.get("/actions", response_model=List[Action])
async def list_actions():
    """Return all action items, newest first."""
    return action_store.all()


@router.post("/actions", response_model=Action, status_code=201)
async def create_action(body: CreateAction, current_user: CurrentUser = Depends(get_current_user)):
    """Create a new action item."""
    now = _now()
    action = Action(
        id=str(uuid.uuid4()),
        title=body.title,
        description=body.description,
        status=body.status,
        linkedRecId=body.linkedRecId,
        comments=[],
        createdAt=now,
        updatedAt=now,
    )
    action_store.add(action)
    
    # Log activity
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="CREATE_ACTION",
        description=f"Created Action Center item: {action.title}",
        details={"action_id": action.id, "title": action.title, "linked_rec_id": action.linkedRecId}
    )
    return action


@router.get("/actions/{action_id}", response_model=Action)
async def get_action(action_id: str):
    action = action_store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")
    return action


@router.patch("/actions/{action_id}", response_model=Action)
async def patch_action(action_id: str, body: PatchAction, current_user: CurrentUser = Depends(get_current_user)):
    """Update title, description, or status of an action."""
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided.")
    if "status" in fields:
        fields["status"] = fields["status"].value if hasattr(fields["status"], "value") else fields["status"]
    fields["updatedAt"] = _now()
    if not action_store.update(action_id, fields):
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")
    updated = action_store.get(action_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Could not retrieve updated action.")
        
    # Log activity
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="UPDATE_ACTION",
        description=f"Updated Action Center item: {updated.title}",
        details={"action_id": action_id, "title": updated.title, "updated_fields": list(fields.keys())}
    )
    return updated


@router.delete("/actions/{action_id}", status_code=204)
async def delete_action(action_id: str, current_user: CurrentUser = Depends(get_current_user)):
    existing = action_store.get(action_id)
    if not action_store.remove(action_id):
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")
        
    # Log activity
    from store import log_activity
    title = existing.title if existing else "unknown action"
    log_activity(
        request=current_user.to_dict(),
        action="DELETE_ACTION",
        description=f"Deleted Action Center item: {title}",
        details={"action_id": action_id, "title": title}
    )


# ─── Comments ─────────────────────────────────────────────────────────────────

@router.post("/actions/{action_id}/comments", response_model=Action)
async def add_comment(action_id: str, body: AddComment, current_user: CurrentUser = Depends(get_current_user)):
    """Append a comment to an action item."""
    action = action_store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")

    comment = ActionComment(
        id=str(uuid.uuid4()),
        text=body.text.strip(),
        author=body.author.strip() or "Admin",
        createdAt=_now(),
    )
    updated_comments = [c.model_dump() for c in action.comments] + [comment.model_dump()]
    action_store.update(action_id, {"comments": updated_comments, "updatedAt": _now()})

    result = action_store.get(action_id)
    if result is None:
        raise HTTPException(status_code=500, detail="Could not retrieve updated action.")
        
    # Log activity
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="ADD_COMMENT",
        description=f"Added comment to action: {result.title}",
        details={"action_id": action_id, "comment_text": comment.text, "comment_author": comment.author}
    )
    return result


@router.delete("/actions/{action_id}/comments/{comment_id}", response_model=Action)
async def delete_comment(action_id: str, comment_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Remove a comment from an action item."""
    action = action_store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")

    filtered = [c.model_dump() for c in action.comments if c.id != comment_id]
    if len(filtered) == len(action.comments):
        raise HTTPException(status_code=404, detail=f"Comment '{comment_id}' not found.")

    action_store.update(action_id, {"comments": filtered, "updatedAt": _now()})
    result = action_store.get(action_id)
    if result is None:
        raise HTTPException(status_code=500, detail="Could not retrieve updated action.")
        
    # Log activity
    from store import log_activity
    log_activity(
        request=current_user.to_dict(),
        action="DELETE_COMMENT",
        description=f"Deleted comment from action: {result.title}",
        details={"action_id": action_id, "comment_id": comment_id}
    )
    return result


# ─── AI Suggested Next Steps ──────────────────────────────────────────────────

_SUGGEST_SYSTEM = """
You are a senior field-service advisor for an oilfield equipment company (WOM – Worldwide Oilfield Machine).
Given details about an overdue or upcoming recertification ticket and the admin comment thread so far,
generate 3–5 concise, actionable next steps. Each step should be a short imperative sentence (≤15 words).
Return ONLY a JSON object: {"steps": ["step 1", "step 2", ...]}.
Do not include explanations, preamble, or markdown.
""".strip()


@router.post("/actions/{action_id}/suggest", response_model=Action)
async def suggest_next_steps(action_id: str, request: Request):
    """Use OpenAI to generate suggested next steps, then save them as a log entry."""
    action = action_store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail=f"Action '{action_id}' not found.")

    # Build context: linked rec details (if any) + comments
    context_parts: list[str] = []

    if action.linkedRecId:
        rec = recommendation_store.get(action.linkedRecId)
        if rec:
            context_parts.append(
                f"Equipment: {rec.equipment or 'unknown'}\n"
                f"Customer: {rec.customer or 'unknown'}\n"
                f"Status: {rec.status}\n"
                f"Recertification due: {rec.recertificationDue or 'unknown'}\n"
                f"AI recommendation: {rec.recommendation or ''}"
            )

    updates = [c for c in action.comments if c.type == "update"]
    if updates:
        updates_text = "\n".join(
            f"[{c.author} @ {c.createdAt[:10]}]: {c.text}" for c in updates
        )
        context_parts.append(f"Activity log:\n{updates_text}")
    else:
        context_parts.append("No updates logged yet.")

    user_msg = "\n\n".join(context_parts)

    try:
        from services.openai_service import build_openai_client
        import json as _json

        client, deployment = build_openai_client()


        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": _SUGGEST_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            max_tokens=512,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        data = _json.loads(raw)
        steps = data.get("steps", [])
        if not isinstance(steps, list):
            steps = [str(steps)]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc}") from exc

    # Save AI suggestion as a log entry in Firestore
    ai_comment = ActionComment(
        id=str(uuid.uuid4()),
        text=_json.dumps({"steps": steps}),
        author="AI Assistant",
        createdAt=_now(),
        type="ai_suggestion",
    )
    updated_comments = [c.model_dump() for c in action.comments] + [ai_comment.model_dump()]
    action_store.update(action_id, {"comments": updated_comments, "updatedAt": _now()})

    result = action_store.get(action_id)
    if result is None:
        raise HTTPException(status_code=500, detail="Could not retrieve updated action.")
        
    # Log activity
    from store import log_activity
    log_activity(
        request=request,
        action="AI_SUGGEST_STEPS",
        description=f"Generated AI suggestions for action: {result.title}",
        details={"action_id": action_id}
    )
    return result
