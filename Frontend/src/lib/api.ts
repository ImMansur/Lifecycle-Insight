import type { Recommendation } from "./wom-data";
import { auth } from "./firebase";

const BASE =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (import.meta.env.VITE_API_URL ?? "http://localhost:8000")
    : "";

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const currentUser = auth.currentUser;
  const role = typeof window !== "undefined" ? localStorage.getItem("wom_user_role") || "Uploader" : "Uploader";
  
  const headers = {
    ...(options.headers || {}),
  } as Record<string, string>;

  if (currentUser) {
    headers["x-user-uid"] = currentUser.uid;
    headers["x-user-email"] = currentUser.email || "";
    headers["x-user-name"] = currentUser.displayName || "";
    headers["x-user-role"] = role;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

export interface Summary {
  inputFolder: string;
  asOf: string;
  filesProcessed: number;
  ok: number;
  highPriority: number;
  needsOcr: number;
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  summary: Summary;
}

export interface PendingDuplicate {
  existingId: string;
  existingFile: string;
  existingCustomer: string | null;
  existingSalesOrder: string | null;
  existingCertificateDate: string | null;
  newRecommendation: Recommendation;
}

export interface ConfirmDuplicateItem {
  existingId: string;
  newRecommendation: Recommendation;
}

export interface IngestResponse {
  processed: number;
  recommendations: Recommendation[];
  pendingDuplicates: PendingDuplicate[];
  errors: string[];
}

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const res = await authenticatedFetch(`${BASE}/api/recommendations`);
  if (!res.ok) throw new Error(`Failed to fetch recommendations: ${res.statusText}`);
  return res.json();
}
export interface IngestProgress {
  progress: number;
  status: string;
  substatus: string;
  files?: Record<string, { progress: number; substatus: string }>;
  result?: IngestResponse;
}

export async function fetchIngestStatus(uploadId: string): Promise<IngestProgress> {
  const res = await authenticatedFetch(`${BASE}/api/ingest/status/${encodeURIComponent(uploadId)}`);
  if (!res.ok) throw new Error("Failed to fetch ingest status");
  return res.json();
}

export async function deleteIngestStatus(uploadId: string): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/ingest/status/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete ingest status: ${res.statusText}`);
  }
}

export async function initUploadProgress(
  uploadId: string,
  filenames: string[],
): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/ingest/init-progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId, filenames }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to init upload progress (${res.status}): ${text}`);
  }
}

export interface ValidateDocumentResponse {
  filename: string;
  pages: number;
  maxPages: number;
  allowed: boolean;
  message: string | null;
}

export async function validateDocument(file: File): Promise<ValidateDocumentResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await authenticatedFetch(`${BASE}/api/validate-document`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Validation failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function ingestFiles(files: File[], uploadId?: string): Promise<IngestResponse> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const url = uploadId ? `${BASE}/api/ingest?upload_id=${encodeURIComponent(uploadId)}` : `${BASE}/api/ingest`;
  const res = await authenticatedFetch(url, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest failed (${res.status}): ${text}`);
  }
  return res.json();
}

// 3.5 MB — safely under Vercel's 4.5 MB function body limit
const CHUNK_SIZE = 3.5 * 1024 * 1024;

/**
 * Upload a single file in chunks through the Vercel backend.
 * Each chunk is staged as an Azure Blob block server-side (no browser→Azure
 * CORS required). On the final chunk the backend assembles and processes the
 * file, returning the normal IngestResponse.
 */
export async function uploadFileInChunks(
  file: File,
  uploadId?: string,
  onChunkProgress?: (pct: number) => void,
): Promise<IngestResponse> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    const form = new FormData();
    form.append("file", chunk, file.name);
    form.append("filename", file.name);
    form.append("chunk_index", String(i));
    form.append("total_chunks", String(totalChunks));

    const url = uploadId ? `${BASE}/api/ingest-chunk?upload_id=${encodeURIComponent(uploadId)}` : `${BASE}/api/ingest-chunk`;
    const res = await authenticatedFetch(url, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ingest failed (${res.status}): ${text}`);
    }

    onChunkProgress?.(Math.round(((i + 1) / totalChunks) * 100));

    if (i === totalChunks - 1) {
      return res.json() as Promise<IngestResponse>;
    }
  }

  throw new Error("No response received from final chunk.");
}

export interface UploadSasResponse {
  url: string;
  blobName: string;
}

/**
 * Get a short-lived Azure Blob SAS URL so the browser can PUT the file
 * directly to blob storage, bypassing Vercel's 4.5 MB function body limit.
 */
export async function getUploadSas(filename: string): Promise<UploadSasResponse> {
  const res = await authenticatedFetch(`${BASE}/api/upload-sas?filename=${encodeURIComponent(filename)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get upload URL (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Tell the backend to process files that are already in Azure Blob Storage.
 * Call this after uploading files via SAS URLs.
 */
export async function ingestFromBlob(blobNames: string[], uploadId?: string): Promise<IngestResponse> {
  const url = uploadId ? `${BASE}/api/ingest-from-blob?upload_id=${encodeURIComponent(uploadId)}` : `${BASE}/api/ingest-from-blob`;
  const res = await authenticatedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blobNames),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function confirmIngestUpdates(
  updates: ConfirmDuplicateItem[],
): Promise<IngestResponse> {
  const res = await authenticatedFetch(`${BASE}/api/ingest/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Confirm failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteRecommendation(id: string): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/recommendations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete failed: ${res.statusText}`);
  }
}

export async function deleteMultipleRecommendations(
  ids: string[],
): Promise<{ deleted: number; not_found: string[] }> {
  const res = await authenticatedFetch(`${BASE}/api/recommendations/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    throw new Error(`Bulk delete failed: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchDocumentUrl(
  filename: string,
): Promise<{ url: string; filename: string }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const needsSas = ext === "docx" || ext === "doc" || ext === "xlsx" || ext === "xls";
  if (needsSas) {
    // Office Online viewer requires a publicly accessible URL — use SAS
    const res = await authenticatedFetch(`${BASE}/api/documents/${encodeURIComponent(filename)}/url`);
    if (!res.ok) throw new Error(`Could not get document URL: ${res.statusText}`);
    return res.json();
  }
  // PDF and images: proxy through backend so Content-Disposition: inline is enforced
  return { url: `${BASE}/api/documents/${encodeURIComponent(filename)}/view`, filename };
}

export interface RecommendationPatch {
  customer?: string;
  salesOrder?: string;
  purchaseOrder?: string;
  jobOrProject?: string;
  location?: string;
  equipment?: string;
  certificateDate?: string;
  serials?: string[];
  partNumbers?: { number: string; description: string | null; qty: number | null }[];
  notes?: string;
  priority?: "High" | "Low" | "Manual review";
}

export async function updateRecommendation(
  id: string,
  patch: RecommendationPatch,
): Promise<import("./wom-data").Recommendation> {
  const res = await authenticatedFetch(`${BASE}/api/recommendations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Action Center ────────────────────────────────────────────────────────────

export type ActionStatus = "in_progress" | "closed" | "failed";

export interface ActionComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  type: "update" | "ai_suggestion";
}

export interface Action {
  id: string;
  title: string;
  description: string | null;
  status: ActionStatus;
  linkedRecId: string | null;
  comments: ActionComment[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchActions(): Promise<Action[]> {
  const res = await authenticatedFetch(`${BASE}/api/actions`);
  if (!res.ok) throw new Error(`Failed to fetch actions: ${res.statusText}`);
  return res.json();
}

export async function createAction(body: {
  title: string;
  description?: string;
  status?: ActionStatus;
  linkedRecId?: string;
}): Promise<Action> {
  const res = await authenticatedFetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create action failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function patchAction(
  id: string,
  patch: { title?: string; description?: string; status?: ActionStatus; linkedRecId?: string },
): Promise<Action> {
  const res = await authenticatedFetch(`${BASE}/api/actions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patch action failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteAction(id: string): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/actions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete action failed: ${res.statusText}`);
  }
}

export async function addComment(
  actionId: string,
  text: string,
  author = "Admin",
): Promise<Action> {
  const res = await authenticatedFetch(`${BASE}/api/actions/${encodeURIComponent(actionId)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, author }),
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Add comment failed (${res.status}): ${text2}`);
  }
  return res.json();
}

export async function deleteComment(actionId: string, commentId: string): Promise<Action> {
  const res = await authenticatedFetch(
    `${BASE}/api/actions/${encodeURIComponent(actionId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete comment failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function suggestNextSteps(actionId: string): Promise<Action> {
  const res = await authenticatedFetch(`${BASE}/api/actions/${encodeURIComponent(actionId)}/suggest`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Suggest failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

export async function exportToExcel(recIds: string[]): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/export/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rec_ids: recIds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wom-records-${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── User Management ──────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

export async function fetchUsers(): Promise<UserProfile[]> {
  const res = await authenticatedFetch(`${BASE}/api/users`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
}

export async function createUser(body: {
  email: string;
  password?: string;
  displayName: string;
  role: string;
}): Promise<UserProfile> {
  const res = await authenticatedFetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create user (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteUser(uid: string): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/users/${encodeURIComponent(uid)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete user: ${res.statusText}`);
  }
}

export async function fetchUserRole(uid: string): Promise<{ role: string }> {
  for (let i = 0; i < 3; i++) {
    try {
      const ts = new Date().getTime();
      const res = await authenticatedFetch(`${BASE}/api/users/role/${encodeURIComponent(uid)}?_t=${ts}`, {
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`Failed to fetch user role: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i === 2) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // exponential backoff 1s, 2s
    }
  }
  return { role: "Uploader" };
}

// ─── Compression & Cost-Saving Logs ───────────────────────────────────────────

export interface CompressionLog {
  id: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  savedSize: number;
  bypassDi: boolean;
  pages: number;
  storageSavings: number;
  diSavings: number;
  totalSavings: number;
  timestamp: string;
}

export interface CompressionLogsSummary {
  totalOriginalSize: number;
  totalCompressedSize: number;
  totalSavedSize: number;
  totalStorageSavings: number;
  totalDiSavings: number;
  totalSavings: number;
  fileCount: number;
}

export interface CompressionLogsResponse {
  logs: CompressionLog[];
  summary: CompressionLogsSummary;
}

export async function fetchCompressionLogs(): Promise<CompressionLogsResponse> {
  const res = await authenticatedFetch(`${BASE}/api/compression-logs`);
  if (!res.ok) throw new Error(`Failed to fetch compression logs: ${res.statusText}`);
  return res.json();
}

export async function clearCompressionLogs(): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/compression-logs/clear`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to clear compression logs: ${res.statusText}`);
  }
}


// ─── User Activity Logs ──────────────────────────────────────────────────────

export interface ActivityLog {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  action: string;
  description: string;
  details: Record<string, any> | null;
  timestamp: string;
}

export async function fetchActivityLogs(): Promise<ActivityLog[]> {
  const res = await authenticatedFetch(`${BASE}/api/activity-logs`);
  if (!res.ok) throw new Error(`Failed to fetch activity logs: ${res.statusText}`);
  return res.json();
}

export async function clearActivityLogs(): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/activity-logs/clear`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to clear activity logs: ${res.statusText}`);
  }
}

export async function logActivityEvent(
  action: string,
  description: string,
  details?: Record<string, any>,
): Promise<void> {
  const res = await authenticatedFetch(`${BASE}/api/activity-logs/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, description, details }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to log client event: ${res.statusText}`);
  }
}
