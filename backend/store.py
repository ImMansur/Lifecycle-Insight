"""Resilient Firestore store that handles key formatting issues."""
from __future__ import annotations

import logging
import os
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from models import Action, Job, JobStatus, Recommendation, CompressionLog, ActivityLog

# Initialize Firebase Admin
def initialize_firestore():
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not service_account_json:
        logging.error("FIREBASE_SERVICE_ACCOUNT_JSON env var not set.")
        return None

    try:
        if firebase_admin._apps:
            return firestore.client()

        cert_dict = json.loads(service_account_json)

        # Fix the private key formatting on the fly
        key = cert_dict.get("private_key", "")
        if "\\n" in key:
            key = key.replace("\\n", "\n")
        
        # Ensure it's wrapped correctly and base64 is clean
        if "-----BEGIN PRIVATE KEY-----" in key:
            parts = key.split("-----BEGIN PRIVATE KEY-----")
            header = "-----BEGIN PRIVATE KEY-----"
            footer = "-----END PRIVATE KEY-----"
            content = parts[1].split(footer)[0].strip()
            
            # Remove all whitespace and existing padding
            clean_content = "".join(content.split()).replace("=", "")
            
            # Re-pad properly (base64 needs to be multiple of 4)
            while len(clean_content) % 4 != 0:
                clean_content += "="
            
            # Re-assemble in standard 64-char lines
            formatted_content = ""
            for i in range(0, len(clean_content), 64):
                formatted_content += clean_content[i:i+64] + "\n"
            
            cert_dict["private_key"] = f"{header}\n{formatted_content}{footer}\n"

        cred = credentials.Certificate(cert_dict)
        firebase_admin.initialize_app(cred)
        logging.info("Firebase Admin initialized successfully with on-the-fly key fixing.")
        return firestore.client()
    except Exception as e:
        logging.error(f"Failed to initialize Firestore even with fix: {e}")
        return None

class RecommendationStore:
    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[Recommendation]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("recommendations").stream()
        except Exception as e:
            logging.error(f"Firestore error in all(): {e}")
            return []
        results: List[Recommendation] = []
        for doc in docs:
            try:
                results.append(Recommendation(**doc.to_dict()))
            except Exception as e:
                logging.warning(f"Skipping invalid recommendation doc {doc.id}: {e}")
        return results

    def add(self, rec: Recommendation) -> None:
        if not self.ready:
            # Last ditch attempt to initialize if it failed before
            self.db = initialize_firestore()
            self.ready = self.db is not None
            if not self.ready:
                logging.error("Cannot add: Firestore still not initialized.")
                return

        try:
            self.db.collection("recommendations").document(rec.id).set(rec.model_dump())
            logging.info(f"Recommendation {rec.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in add(): {e}")

    def remove(self, rec_id: str) -> bool:
        if not self.ready: return False
        try:
            doc_ref = self.db.collection("recommendations").document(rec_id)
            if doc_ref.get().exists:
                doc_ref.delete()
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in remove(): {e}")
            return False

    def get(self, rec_id: str):
        if not self.ready: return None
        try:
            doc = self.db.collection("recommendations").document(rec_id).get()
            if doc.exists:
                return Recommendation(**doc.to_dict())
            return None
        except Exception as e:
            logging.error(f"Firestore error in get(): {e}")
            return None

    def update(self, rec_id: str, patch: dict) -> bool:
        if not self.ready: return False
        try:
            doc_ref = self.db.collection("recommendations").document(rec_id)
            if doc_ref.get().exists:
                doc_ref.update(patch)
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in update(): {e}")
            return False

    def clear(self) -> None:
        if not self.ready: return
        try:
            batch = self.db.batch()
            docs = self.db.collection("recommendations").list_documents()
            for doc in docs:
                batch.delete(doc)
            batch.commit()
        except Exception as e:
            logging.error(f"Firestore error in clear(): {e}")

recommendation_store = RecommendationStore()


class ActionStore:
    """Firestore-backed store for Action Center items."""

    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[Action]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("actions").order_by("createdAt", direction=firestore.Query.DESCENDING).stream()
            return [Action(**doc.to_dict()) for doc in docs]
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.all(): {e}")
            return []

    def get(self, action_id: str) -> Optional[Action]:
        if not self.ready:
            return None
        try:
            doc = self.db.collection("actions").document(action_id).get()
            if doc.exists:
                return Action(**doc.to_dict())
            return None
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.get(): {e}")
            return None

    def add(self, action: Action) -> None:
        if not self.ready:
            return
        try:
            self.db.collection("actions").document(action.id).set(action.model_dump())
            logging.info(f"Action {action.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.add(): {e}")

    def update(self, action_id: str, patch: dict) -> bool:
        if not self.ready:
            return False
        try:
            doc_ref = self.db.collection("actions").document(action_id)
            if doc_ref.get().exists:
                doc_ref.update(patch)
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.update(): {e}")
            return False

    def remove(self, action_id: str) -> bool:
        if not self.ready:
            return False
        try:
            doc_ref = self.db.collection("actions").document(action_id)
            if doc_ref.get().exists:
                doc_ref.delete()
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.remove(): {e}")
            return False


class JobStore:
    """Firestore-backed store for async ingest jobs."""

    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[Job]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("jobs").stream()
        except Exception as e:
            logging.error(f"Firestore error in JobStore.all(): {e}")
            return []
        results: List[Job] = []
        for doc in docs:
            try:
                results.append(Job(**doc.to_dict()))
            except Exception as e:
                logging.warning(f"Skipping invalid job doc {doc.id}: {e}")
        return results

    def get(self, job_id: str) -> Job | None:
        if not self.ready:
            return None
        try:
            doc = self.db.collection("jobs").document(job_id).get()
            if doc.exists:
                return Job(**doc.to_dict())
            return None
        except Exception as e:
            logging.error(f"Firestore error in JobStore.get(): {e}")
            return None

    def add(self, job: Job) -> None:
        if not self.ready:
            self.db = initialize_firestore()
            self.ready = self.db is not None
            if not self.ready:
                logging.error("Cannot add job: Firestore still not initialized.")
                return
        try:
            self.db.collection("jobs").document(job.id).set(job.model_dump())
            logging.info(f"Job {job.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in JobStore.add(): {e}")

    def update(self, job_id: str, patch: dict) -> bool:
        if not self.ready:
            return False
        try:
            doc_ref = self.db.collection("jobs").document(job_id)
            if doc_ref.get().exists:
                doc_ref.update(patch)
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in JobStore.update(): {e}")
            return False

    def claim_pending_job(self) -> Job | None:
        if not self.ready:
            return None
        try:
            query = self.db.collection("jobs").where("status", "==", JobStatus.pending.value).order_by("createdAt").limit(1)
            docs = list(query.stream())
            if not docs:
                return None
            doc = docs[0]
            job_id = doc.id
            self.db.collection("jobs").document(job_id).update({
                "status": JobStatus.processing.value,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "progress": 5,
            })
            updated_doc = self.db.collection("jobs").document(job_id).get()
            if updated_doc.exists:
                return Job(**updated_doc.to_dict())
            return Job(**doc.to_dict())
        except Exception as e:
            logging.error(f"Firestore error in JobStore.claim_pending_job(): {e}")
            return None


action_store = ActionStore()
job_store = JobStore()


class CompressionLogStore:
    """Firestore-backed store for Compression and Cost-Saving logs."""

    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[CompressionLog]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("compression_logs").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
            results: List[CompressionLog] = []
            for doc in docs:
                try:
                    results.append(CompressionLog(**doc.to_dict()))
                except Exception as e:
                    logging.warning(f"Skipping invalid compression log doc {doc.id}: {e}")
            return results
        except Exception as e:
            logging.error(f"Firestore error in CompressionLogStore.all(): {e}")
            return []

    def add(self, log: CompressionLog) -> None:
        if not self.ready:
            self.db = initialize_firestore()
            self.ready = self.db is not None
            if not self.ready:
                logging.error("Cannot add log: Firestore still not initialized.")
                return
        try:
            self.db.collection("compression_logs").document(log.id).set(log.model_dump())
            logging.info(f"Compression log {log.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in CompressionLogStore.add(): {e}")

    def clear(self) -> None:
        if not self.ready:
            return
        try:
            batch = self.db.batch()
            docs = self.db.collection("compression_logs").list_documents()
            for doc in docs:
                batch.delete(doc)
            batch.commit()
            logging.info("All compression logs cleared from Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in CompressionLogStore.clear(): {e}")


compression_log_store = CompressionLogStore()


class UploadProgressStore:
    """File-system-backed upload progress — shared across local processes/workers without Firebase cost."""

    def __init__(self) -> None:
        self.temp_dir = Path(tempfile.gettempdir()) / "wom_upload_progress"
        try:
            self.temp_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logging.error(f"Failed to create temp directory for upload progress: {e}")

    def _get_path(self, upload_id: str) -> Path:
        # Sanitize upload_id to prevent path traversal
        safe_id = "".join(c for c in upload_id if c.isalnum() or c in "-_")
        return self.temp_dir / f"{safe_id}.json"

    def get(self, upload_id: str) -> dict | None:
        path = self._get_path(upload_id)
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                logging.error(f"Error reading upload progress file: {e}")
        return None

    def save(self, upload_id: str, data: dict) -> None:
        path = self._get_path(upload_id)
        try:
            path.write_text(json.dumps(data), encoding="utf-8")
        except Exception as e:
            logging.error(f"Error writing upload progress file: {e}")

    def delete(self, upload_id: str) -> None:
        path = self._get_path(upload_id)
        if path.exists():
            try:
                path.unlink()
            except Exception as e:
                logging.error(f"Error deleting upload progress file: {e}")


upload_progress_store_fs = UploadProgressStore()


class ActivityLogStore:
    """Firestore-backed store for User Activity Logs."""

    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[ActivityLog]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("activity_logs").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
            results: List[ActivityLog] = []
            for doc in docs:
                try:
                    results.append(ActivityLog(**doc.to_dict()))
                except Exception as e:
                    logging.warning(f"Skipping invalid activity log doc {doc.id}: {e}")
            return results
        except Exception as e:
            logging.error(f"Firestore error in ActivityLogStore.all(): {e}")
            return []

    def add(self, log: ActivityLog) -> None:
        if not self.ready:
            self.db = initialize_firestore()
            self.ready = self.db is not None
            if not self.ready:
                logging.error("Cannot add activity log: Firestore still not initialized.")
                return
        try:
            self.db.collection("activity_logs").document(log.id).set(log.model_dump())
            logging.info(f"Activity log {log.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in ActivityLogStore.add(): {e}")

    def clear(self) -> None:
        if not self.ready:
            return
        try:
            batch = self.db.batch()
            docs = self.db.collection("activity_logs").list_documents()
            for doc in docs:
                batch.delete(doc)
            batch.commit()
            logging.info("All activity logs cleared from Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in ActivityLogStore.clear(): {e}")


activity_log_store = ActivityLogStore()


def log_activity(request: "fastapi.Request" | dict | None, action: str, description: str, details: dict = None) -> None:
    """Helper to extract user headers from the incoming request and log system activity."""
    import uuid
    from datetime import datetime, timezone
    
    try:
        uid = "system"
        email = "system@womgroup.com"
        name = "System"
        role = "System"

        if request is not None:
            if isinstance(request, dict):
                uid = request.get("uid", "system")
                email = request.get("email", "system@womgroup.com")
                name = request.get("name", "System")
                role = request.get("role", "System")
            else:
                uid = request.headers.get("x-user-uid", "system")
                email = request.headers.get("x-user-email", "system@womgroup.com")
                name = request.headers.get("x-user-name", "System")
                role = request.headers.get("x-user-role", "System")
        
        # Build log model
        log_entry = ActivityLog(
            id=str(uuid.uuid4()),
            userId=uid,
            userEmail=email,
            userName=name,
            userRole=role,
            action=action,
            description=description,
            details=details or {},
            timestamp=datetime.now(timezone.utc).isoformat()
        )
        
        activity_log_store.add(log_entry)
    except Exception as e:
        logging.error(f"Failed to log user activity: {e}")



