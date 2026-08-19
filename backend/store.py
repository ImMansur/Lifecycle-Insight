"""Azure Cosmos DB-backed data store (formerly Firestore).

Container design mirrors the previous Firestore collections 1:1 so the
business logic in routers/*.py needed almost no changes: recommendations,
actions, jobs, compression_logs, activity_logs, users. Each container uses
`/id` as its partition key — fine at this app's scale (an internal tool, not
a massive multi-tenant workload).
"""
from __future__ import annotations

import logging
import os
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from models import Action, Job, JobStatus, Recommendation, CompressionLog, ActivityLog

_DATABASE_NAME = "womdb"

_client: Optional[CosmosClient] = None
_database = None
_containers: dict = {}


def _get_database():
    global _client, _database
    if _database is not None:
        return _database
    endpoint = os.environ.get("COSMOS_ENDPOINT")
    key = os.environ.get("COSMOS_KEY")
    if not endpoint or not key:
        logging.error("COSMOS_ENDPOINT / COSMOS_KEY env vars not set.")
        return None
    try:
        _client = CosmosClient(endpoint, credential=key)
        _database = _client.create_database_if_not_exists(id=_DATABASE_NAME)
        return _database
    except Exception as e:
        logging.error(f"Failed to initialize Cosmos DB: {e}")
        return None


def _get_container(name: str):
    if name in _containers:
        return _containers[name]
    db = _get_database()
    if db is None:
        return None
    try:
        container = db.create_container_if_not_exists(id=name, partition_key=PartitionKey(path="/id"))
        _containers[name] = container
        return container
    except Exception as e:
        logging.error(f"Failed to get/create Cosmos container '{name}': {e}")
        return None


class RecommendationStore:
    CONTAINER = "recommendations"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[Recommendation]:
        if not self._ensure_ready():
            return []
        try:
            items = self.container.query_items(query="SELECT * FROM c", enable_cross_partition_query=True)
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.all(): {e}")
            return []
        results: List[Recommendation] = []
        for item in items:
            try:
                if "_ts" in item:
                    item["ts"] = item["_ts"]
                results.append(Recommendation(**item))

            except Exception as e:
                logging.warning(f"Skipping invalid recommendation doc {item.get('id')}: {e}")
        return results

    def add(self, rec: Recommendation) -> None:
        if not self._ensure_ready():
            logging.error("Cannot add: Cosmos DB still not initialized.")
            return
        try:
            self.container.upsert_item(body=rec.model_dump())
            logging.info(f"Recommendation {rec.id} saved to Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.add(): {e}")

    def remove(self, rec_id: str) -> bool:
        if not self._ensure_ready():
            return False
        try:
            self.container.delete_item(item=rec_id, partition_key=rec_id)
            return True
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.remove(): {e}")
            return False

    def get(self, rec_id: str):
        if not self._ensure_ready():
            return None
        try:
            item = self.container.read_item(item=rec_id, partition_key=rec_id)
            if "_ts" in item:
                item["ts"] = item["_ts"]
            return Recommendation(**item)

        except CosmosResourceNotFoundError:
            return None
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.get(): {e}")
            return None

    def update(self, rec_id: str, patch: dict) -> bool:
        if not self._ensure_ready():
            return False
        try:
            item = self.container.read_item(item=rec_id, partition_key=rec_id)
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.update() read: {e}")
            return False
        try:
            item.update(patch)
            self.container.upsert_item(body=item)
            return True
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.update() write: {e}")
            return False

    def clear(self) -> None:
        if not self._ensure_ready():
            return
        try:
            items = list(self.container.query_items(query="SELECT c.id FROM c", enable_cross_partition_query=True))
            for item in items:
                self.container.delete_item(item=item["id"], partition_key=item["id"])
        except Exception as e:
            logging.error(f"Cosmos error in RecommendationStore.clear(): {e}")

recommendation_store = RecommendationStore()


class ActionStore:
    """Cosmos DB-backed store for Action Center items."""

    CONTAINER = "actions"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[Action]:
        if not self._ensure_ready():
            return []
        try:
            items = self.container.query_items(
                query="SELECT * FROM c ORDER BY c.createdAt DESC", enable_cross_partition_query=True
            )
            return [Action(**item) for item in items]
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.all(): {e}")
            return []

    def get(self, action_id: str) -> Optional[Action]:
        if not self._ensure_ready():
            return None
        try:
            item = self.container.read_item(item=action_id, partition_key=action_id)
            return Action(**item)
        except CosmosResourceNotFoundError:
            return None
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.get(): {e}")
            return None

    def add(self, action: Action) -> None:
        if not self._ensure_ready():
            return
        try:
            self.container.upsert_item(body=action.model_dump())
            logging.info(f"Action {action.id} saved to Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.add(): {e}")

    def update(self, action_id: str, patch: dict) -> bool:
        if not self._ensure_ready():
            return False
        try:
            item = self.container.read_item(item=action_id, partition_key=action_id)
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.update() read: {e}")
            return False
        try:
            item.update(patch)
            self.container.upsert_item(body=item)
            return True
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.update() write: {e}")
            return False

    def remove(self, action_id: str) -> bool:
        if not self._ensure_ready():
            return False
        try:
            self.container.delete_item(item=action_id, partition_key=action_id)
            return True
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in ActionStore.remove(): {e}")
            return False


class JobStore:
    """Cosmos DB-backed store for async ingest jobs."""

    CONTAINER = "jobs"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[Job]:
        if not self._ensure_ready():
            return []
        try:
            items = self.container.query_items(query="SELECT * FROM c", enable_cross_partition_query=True)
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.all(): {e}")
            return []
        results: List[Job] = []
        for item in items:
            try:
                results.append(Job(**item))
            except Exception as e:
                logging.warning(f"Skipping invalid job doc {item.get('id')}: {e}")
        return results

    def get(self, job_id: str) -> Job | None:
        if not self._ensure_ready():
            return None
        try:
            item = self.container.read_item(item=job_id, partition_key=job_id)
            return Job(**item)
        except CosmosResourceNotFoundError:
            return None
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.get(): {e}")
            return None

    def add(self, job: Job) -> None:
        if not self._ensure_ready():
            logging.error("Cannot add job: Cosmos DB still not initialized.")
            return
        try:
            self.container.upsert_item(body=job.model_dump())
            logging.info(f"Job {job.id} saved to Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.add(): {e}")

    def update(self, job_id: str, patch: dict) -> bool:
        if not self._ensure_ready():
            return False
        try:
            item = self.container.read_item(item=job_id, partition_key=job_id)
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.update() read: {e}")
            return False
        try:
            item.update(patch)
            self.container.upsert_item(body=item)
            return True
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.update() write: {e}")
            return False

    def claim_pending_job(self) -> Job | None:
        if not self._ensure_ready():
            return None
        try:
            query = "SELECT TOP 1 * FROM c WHERE c.status = @status ORDER BY c.createdAt"
            params = [{"name": "@status", "value": JobStatus.pending.value}]
            docs = list(self.container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
            if not docs:
                return None
            item = docs[0]
            item["status"] = JobStatus.processing.value
            item["updatedAt"] = datetime.now(timezone.utc).isoformat()
            item["progress"] = 5
            self.container.upsert_item(body=item)
            return Job(**item)
        except Exception as e:
            logging.error(f"Cosmos error in JobStore.claim_pending_job(): {e}")
            return None


action_store = ActionStore()
job_store = JobStore()


class CompressionLogStore:
    """Cosmos DB-backed store for Compression and Cost-Saving logs."""

    CONTAINER = "compression_logs"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[CompressionLog]:
        if not self._ensure_ready():
            return []
        try:
            items = self.container.query_items(
                query="SELECT * FROM c ORDER BY c.timestamp DESC", enable_cross_partition_query=True
            )
            results: List[CompressionLog] = []
            for item in items:
                try:
                    results.append(CompressionLog(**item))
                except Exception as e:
                    logging.warning(f"Skipping invalid compression log doc {item.get('id')}: {e}")
            return results
        except Exception as e:
            logging.error(f"Cosmos error in CompressionLogStore.all(): {e}")
            return []

    def add(self, log: CompressionLog) -> None:
        if not self._ensure_ready():
            logging.error("Cannot add log: Cosmos DB still not initialized.")
            return
        try:
            self.container.upsert_item(body=log.model_dump())
            logging.info(f"Compression log {log.id} saved to Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in CompressionLogStore.add(): {e}")

    def clear(self) -> None:
        if not self._ensure_ready():
            return
        try:
            items = list(self.container.query_items(query="SELECT c.id FROM c", enable_cross_partition_query=True))
            for item in items:
                self.container.delete_item(item=item["id"], partition_key=item["id"])
            logging.info("All compression logs cleared from Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in CompressionLogStore.clear(): {e}")


compression_log_store = CompressionLogStore()


class UploadProgressStore:
    """File-system-backed upload progress — shared across local processes/workers without any DB cost."""

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
    """Cosmos DB-backed store for User Activity Logs."""

    CONTAINER = "activity_logs"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[ActivityLog]:
        if not self._ensure_ready():
            return []
        try:
            items = self.container.query_items(
                query="SELECT * FROM c ORDER BY c.timestamp DESC", enable_cross_partition_query=True
            )
            results: List[ActivityLog] = []
            for item in items:
                try:
                    results.append(ActivityLog(**item))
                except Exception as e:
                    logging.warning(f"Skipping invalid activity log doc {item.get('id')}: {e}")
            return results
        except Exception as e:
            logging.error(f"Cosmos error in ActivityLogStore.all(): {e}")
            return []

    def add(self, log: ActivityLog) -> None:
        if not self._ensure_ready():
            logging.error("Cannot add activity log: Cosmos DB still not initialized.")
            return
        try:
            self.container.upsert_item(body=log.model_dump())
            logging.info(f"Activity log {log.id} saved to Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in ActivityLogStore.add(): {e}")

    def clear(self) -> None:
        if not self._ensure_ready():
            return
        try:
            items = list(self.container.query_items(query="SELECT c.id FROM c", enable_cross_partition_query=True))
            for item in items:
                self.container.delete_item(item=item["id"], partition_key=item["id"])
            logging.info("All activity logs cleared from Cosmos DB.")
        except Exception as e:
            logging.error(f"Cosmos error in ActivityLogStore.clear(): {e}")


activity_log_store = ActivityLogStore()


def log_activity(request, action: str, description: str, details: dict = None) -> None:
    """Helper to log system activity for the acting user.

    `request` may be:
      - a dict shaped like {"uid", "email", "name", "role"} (e.g. from
        `auth.CurrentUser.to_dict()` after JWT verification), or
      - None (system-initiated action).

    NOTE: this intentionally no longer accepts a raw FastAPI Request object /
    reads x-user-* headers — those are client-supplied and spoofable. Callers
    must pass the verified user dict from `Depends(get_current_user)`.
    """
    import uuid
    from datetime import datetime, timezone

    try:
        uid = "system"
        email = "system@womgroup.com"
        name = "System"
        role = "System"

        if isinstance(request, dict):
            uid = request.get("uid", "system")
            email = request.get("email", "system@womgroup.com")
            name = request.get("name", "System")
            role = request.get("role", "System")

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


class UserStore:
    """Cosmos DB-backed store for user accounts (profile + hashed password + role)."""

    CONTAINER = "users"

    def __init__(self) -> None:
        self.container = _get_container(self.CONTAINER)
        self.ready = self.container is not None

    def _ensure_ready(self) -> bool:
        if not self.ready:
            self.container = _get_container(self.CONTAINER)
            self.ready = self.container is not None
        return self.ready

    def all(self) -> List[dict]:
        if not self._ensure_ready():
            return []
        try:
            return list(self.container.query_items(query="SELECT * FROM c", enable_cross_partition_query=True))
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.all(): {e}")
            return []

    def get(self, uid: str) -> Optional[dict]:
        if not self._ensure_ready():
            return None
        try:
            return self.container.read_item(item=uid, partition_key=uid)
        except CosmosResourceNotFoundError:
            return None
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.get(): {e}")
            return None

    def get_by_email(self, email: str) -> Optional[dict]:
        if not self._ensure_ready():
            return None
        try:
            query = "SELECT * FROM c WHERE c.email = @email"
            params = [{"name": "@email", "value": email}]
            items = list(self.container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
            return items[0] if items else None
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.get_by_email(): {e}")
            return None

    def add(self, user: dict) -> None:
        if not self._ensure_ready():
            logging.error("Cannot add user: Cosmos DB still not initialized.")
            return
        try:
            self.container.upsert_item(body=user)
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.add(): {e}")

    def update(self, uid: str, patch: dict) -> bool:
        if not self._ensure_ready():
            return False
        try:
            item = self.container.read_item(item=uid, partition_key=uid)
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.update() read: {e}")
            return False
        try:
            item.update(patch)
            self.container.upsert_item(body=item)
            return True
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.update() write: {e}")
            return False

    def remove(self, uid: str) -> bool:
        if not self._ensure_ready():
            return False
        try:
            self.container.delete_item(item=uid, partition_key=uid)
            return True
        except CosmosResourceNotFoundError:
            return False
        except Exception as e:
            logging.error(f"Cosmos error in UserStore.remove(): {e}")
            return False


user_store = UserStore()


