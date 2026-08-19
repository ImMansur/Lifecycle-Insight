import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ingestFiles,
  uploadFileInChunks,
  fetchIngestStatus,
  deleteIngestStatus,
  initUploadProgress,
  validateDocument,
  confirmIngestUpdates,
  type IngestResponse,
  type IngestProgress,
  type PendingDuplicate,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LoadingScreen, type FileUploadProgress } from "@/components/wom/LoadingScreen";
import { NotificationBell } from "@/components/wom/NotificationBell";


import {
  Upload,
  FileText,
  X,
  AlertTriangle,
  CloudUpload,
  CheckCircle2,
  ShieldAlert,
  LogOut,
  User,
  ChevronDown,
  Loader2,
  Zap,
  Wrench,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

// UserMenu component moved to __root.tsx layout wrapper

// Stay safely under Vercel's 4.5 MB function body limit for batch uploads
const VERCEL_SAFE_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_PAGES = 30;

type BlockedFile = {
  name: string;
  reason: "size" | "pages";
  size?: number;
  pages?: number;
};

function startIngestStatusPolling(
  uploadId: string,
  onUpdate: (status: IngestProgress) => void,
): { stop: () => void; promise: Promise<IngestResponse> } {
  let stopped = false;
  let rejectPromise: (err: Error) => void;
  let resolvePromise: (res: IngestResponse) => void;

  const promise = new Promise<IngestResponse>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const poll = async () => {
    while (!stopped) {
      try {
        const status = await fetchIngestStatus(uploadId);
        onUpdate(status);

        const isFinished = status.progress >= 100 && (
          !!status.result ||
          status.status === "Failed" ||
          status.substatus === "Completed"
        );

        if (isFinished) {
          stopped = true;
          if (status.status === "Failed") {
            rejectPromise(new Error(status.substatus || "Ingestion failed"));
          } else if (status.result) {
            resolvePromise(status.result);
          } else {
            resolvePromise({
              processed: 0,
              recommendations: [],
              pendingDuplicates: [],
              errors: [status.substatus || "Ingestion completed without result data."],
            });
          }
          break;
        }
      } catch {
        // Ignore transient polling errors
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void poll();

  return {
    stop: () => {
      stopped = true;
    },
    promise,
  };
}

function UploadPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filePages, setFilePages] = useState<Record<string, number>>({});
  const [loadingVisible, setLoadingVisible] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadSubStatus, setUploadSubStatus] = useState("");
  const [uploadFileProgress, setUploadFileProgress] = useState<FileUploadProgress[]>([]);
  const [uploadDuration, setUploadDuration] = useState<string>("");
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Developer") {
        navigate({ to: "/developer" });
      } else if (user.role === "Analysis") {
        navigate({ to: "/dashboard" });
      }
    }
  }, [user, loading, navigate]);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<IngestResponse | null>(null);


  // Duplicate-confirmation popup state
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicate[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [blockedFiles, setBlockedFiles] = useState<BlockedFile[]>([]);
  const [validatingFiles, setValidatingFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (filesToUpload: File[]): Promise<IngestResponse> => {
      const isLocal =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      const uploadId = crypto.randomUUID();
      const total = filesToUpload.length;
      const totalSize = filesToUpload.reduce((acc, f) => acc + f.size, 0);
      const useBatchUpload = isLocal || totalSize <= VERCEL_SAFE_BATCH_BYTES;

      const applyProgress = (next: number) => {
        setUploadProgress((prev) => Math.max(prev, Math.min(100, next)));
      };

      const { stop: stopPolling, promise: pollingPromise } = startIngestStatusPolling(uploadId, (status) => {
        if (status.progress > 0) {
          applyProgress(status.progress);
        }
        if (status.status) {
          setUploadStatus(status.status);
        }
        if (status.substatus) {
          setUploadSubStatus(status.substatus);
        }
        if (status.files) {
          setUploadFileProgress(
            Object.entries(status.files).map(([name, file]) => ({
              name: name.split(/[/\\]/).pop() ?? name,
              progress: file.progress,
              substatus: file.substatus,
            })),
          );
        }
      });

      try {
        setUploadProgress(1);
        setUploadStatus("Uploading Documents");
        setUploadSubStatus(
          total > 1
            ? `Sending ${total} files to the server...`
            : "Sending file to the server...",
        );
        setUploadFileProgress(
          filesToUpload.map((f) => ({
            name: f.name,
            progress: 0,
            substatus: "Queued...",
          })),
        );

        try {
          await initUploadProgress(
            uploadId,
            filesToUpload.map((f) => f.name),
          );
        } catch {
          // Best-effort — polling will still work once the backend writes progress.
        }

        if (useBatchUpload) {
          await ingestFiles(filesToUpload, uploadId);
          const finalResult = await pollingPromise;
          try {
            await deleteIngestStatus(uploadId);
          } catch {
            // best effort cleanup
          }
          return finalResult;
        }

        const combined: IngestResponse = {
          processed: 0,
          recommendations: [],
          pendingDuplicates: [],
          errors: [],
        };

        for (let i = 0; i < total; i++) {
          const file = filesToUpload[i];
          setUploadSubStatus(
            total > 1
              ? `Uploading file ${i + 1} of ${total}: ${file.name}`
              : `Uploading ${file.name}...`,
          );

          try {
            await uploadFileInChunks(file, uploadId);
          } catch (err: any) {
            combined.errors.push(`${file.name}: upload failed — ${err.message || err}`);
          }
        }

        try {
          const finalResult = await pollingPromise;
          combined.processed += finalResult.processed;
          combined.recommendations.push(...finalResult.recommendations);
          combined.pendingDuplicates.push(...finalResult.pendingDuplicates);
          combined.errors.push(...finalResult.errors);
        } catch (err: any) {
          combined.errors.push(`Processing failed — ${err.message || err}`);
        }

        try {
          await deleteIngestStatus(uploadId);
        } catch {
          // best effort cleanup
        }

        return combined;
      } finally {
        stopPolling();
      }
    },
    onMutate: () => {
      startTimeRef.current = performance.now();
      setLoadingVisible(true);
      setUploadProgress(0);
      setUploadStatus("Uploading Documents");
      setUploadSubStatus("Preparing upload...");
      setUploadFileProgress([]);
    },
    onSuccess: (data) => {
      const durationSec = ((performance.now() - startTimeRef.current) / 1000).toFixed(1);
      setUploadDuration(durationSec);

      // Snap to 100%
      setUploadProgress(100);
      setUploadStatus("Complete");
      setUploadSubStatus("Finished processing!");

      qc.invalidateQueries({ queryKey: ["recommendations"] });

      for (const rec of data.recommendations) {
        const needsReview =
          rec.priority === "Manual review" || rec.extractionStatus !== "OK" || !rec.customer;
        addNotification({
          fileName: rec.sourceFile,
          status: needsReview ? "warning" : "success",
          message: needsReview
            ? "Uploaded successfully · human review needed"
            : "Processed successfully",
        });
      }
      for (const err of data.errors) {
        const colonIdx = err.indexOf(": ");
        const fileName = colonIdx !== -1 ? err.slice(0, colonIdx) : err;
        const message = colonIdx !== -1 ? err.slice(colonIdx + 2) : "Processing failed";
        addNotification({ fileName, status: "error", message });
      }

      // If the backend flagged duplicates, pause here and let the admin decide.
      if (data.pendingDuplicates && data.pendingDuplicates.length > 0) {
        setSavedCount(data.processed);
        setPendingDuplicates(data.pendingDuplicates);
        setLoadingVisible(false);
        setUploadProgress(0);
        setUploadFileProgress([]);
        return;
      }

      // Display results screen with duration
      setUploadResult(data);
      setLoadingVisible(false);
      setUploadProgress(0);
      setUploadFileProgress([]);
      setFilePages({});
    },
    onError: (err: Error) => {
      addNotification({
        fileName: files.map((f) => f.name).join(", ") || "Upload",
        status: "error",
        message: `Upload failed · ${err.message}`,
      });
      setLoadingVisible(false);
      setUploadProgress(0);
      setUploadFileProgress([]);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmIngestUpdates,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      for (const rec of data.recommendations) {
        addNotification({
          fileName: rec.sourceFile,
          status: "success",
          message: "Replaced existing record",
        });
      }
      setPendingDuplicates([]);
      setSavedCount(0);
      navigate({ to: "/dashboard" });
    },
    onError: (err: Error) => {
      addNotification({ fileName: "Confirm", status: "error", message: err.message });
    },
  });

  const handleReplaceAll = () => {
    const updates = pendingDuplicates.map((d) => ({
      existingId: d.existingId,
      newRecommendation: d.newRecommendation,
    }));
    confirmMutation.mutate(updates);
  };

  const handleCancelDuplicates = () => {
    // Discard the new uploads — nothing gets replaced.
    setPendingDuplicates([]);
    setSavedCount(0);
    navigate({ to: "/dashboard" });
  };



  const addFiles = async (incoming: FileList | File[]) => {
    const filtered = Array.from(incoming).filter((f) => /\.(pdf|doc|docx)$/i.test(f.name));
    const names = new Set(files.map((f) => f.name));
    const newFiles = filtered.filter((f) => !names.has(f.name));
    if (newFiles.length === 0) return;

    setValidatingFiles(true);
    const blocked: BlockedFile[] = [];
    const pageCounts: { file: File; pages: number }[] = [];

    try {
      for (const f of newFiles) {
        try {
          const result = await validateDocument(f);
          pageCounts.push({ file: f, pages: result.pages });
        } catch {
          pageCounts.push({ file: f, pages: 1 });
        }
      }

      const currentPages = Object.values(filePages).reduce((acc, p) => acc + p, 0);
      let runningPages = currentPages;
      let currentSize = files.reduce((acc, f) => acc + f.size, 0);
      const added: File[] = [];
      const newlyAddedPages: Record<string, number> = {};

      for (const { file, pages } of pageCounts) {
        if (runningPages + pages > MAX_TOTAL_PAGES) {
          blocked.push({ name: file.name, reason: "pages", pages });
        } else if (currentSize + file.size > MAX_TOTAL_SIZE) {
          blocked.push({ name: file.name, reason: "size", size: file.size });
        } else {
          added.push(file);
          newlyAddedPages[file.name] = pages;
          runningPages += pages;
          currentSize += file.size;
        }
      }

      if (blocked.length > 0) {
        setBlockedFiles(blocked);
      }
      if (added.length > 0) {
        setFiles((prev) => [...prev, ...added]);
        setFilePages((prev) => ({ ...prev, ...newlyAddedPages }));
      }
    } finally {
      setValidatingFiles(false);
    }
  };

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
    setFilePages((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleProcess = () => {
    if (files.length > 0) {
      setLoadingVisible(true);
      setUploadProgress(0);
      setUploadStatus("Uploading Documents");
      setUploadSubStatus("Preparing upload...");
      setUploadFileProgress([]);
      mutation.mutate(files);
    }
  };



  return (
    <>
      {loadingVisible && (
        <LoadingScreen
          title="WOM"
          subtitle="Lifecycle"
          statusText={uploadStatus || "Processing Documents"}
          subStatusText={uploadSubStatus || "Starting pipeline..."}
          progressValue={uploadProgress}
          fileProgress={uploadFileProgress}
        />
      )}
    <div className="w-full flex-1 flex flex-col items-center justify-center p-8">
      {uploadResult ? (
        <div className="w-full max-w-3xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center space-y-4">
            {uploadResult.errors && uploadResult.errors.length > 0 ? (
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-amber-500/10 ring-8 ring-amber-500/5 mb-6">
                <AlertTriangle className="size-10 text-amber-500" />
              </div>
            ) : (
              <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-green-500/10 ring-8 ring-green-500/5 mb-6">
                <CheckCircle2 className="size-10 text-green-500" />
              </div>
            )}
            <h1 className="font-display text-4xl font-black tracking-tight">Upload Logs</h1>
            <p className="text-muted-foreground text-base">
              Processed {uploadResult.processed} file{uploadResult.processed !== 1 ? "s" : ""} and generated{" "}
              <strong>{uploadResult.recommendations?.length || 0}</strong> recommendation{uploadResult.recommendations?.length !== 1 ? "s" : ""}{" "}
              in <span className="text-primary font-mono font-extrabold text-lg px-2 py-0.5 bg-primary/5 rounded-md border border-primary/10">{uploadDuration}s</span>.
            </p>
          </div>

          <div
            className={`space-y-4 p-6 rounded-3xl border ${uploadResult.errors && uploadResult.errors.length > 0 ? "bg-secondary/30 border-border/40" : "bg-green-500/5 border-green-500/20"}`}
          >
            {uploadResult.errors && uploadResult.errors.length > 0 ? (
              <>
                <h3 className="font-semibold flex items-center gap-2">
                  <ShieldAlert className="size-5 text-destructive" />
                  {uploadResult.errors.length} Warning{uploadResult.errors.length !== 1 ? "s" : ""}
                </h3>
                <div className="max-h-80 overflow-y-auto pr-2 space-y-3">
                  {uploadResult.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive font-mono"
                    >
                      {err}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <h3 className="font-semibold flex items-center gap-2 text-green-600 dark:text-green-500">
                <CheckCircle2 className="size-5" />
                No warnings. All documents processed successfully!
              </h3>
            )}
          </div>

          <div className="flex justify-center pt-4 gap-4">
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setUploadResult(null);
                setFiles([]);
              }}
              className="font-bold px-8 h-14 rounded-xl text-lg"
            >
              Upload More
            </Button>
            <Button
              size="lg"
              onClick={() => navigate({ to: "/dashboard" })}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-8 h-14 rounded-xl text-lg shadow-xl shadow-primary/20"
            >
              Go to Dashboard
            </Button>

          </div>
        </div>
      ) : (
        <div className="w-full max-w-[1600px] grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 py-6 items-start animate-in fade-in zoom-in-95 duration-500">
          {/* Left Column: Upload cockpit */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-black tracking-tight text-[#0D1117] md:text-4xl">
                Upload Certificates of Conformance
              </h1>
              <p className="text-sm text-muted-foreground font-medium">
                Supported formats: PDF, DOC, DOCX. Upload certificates to parse and match them
                against rules.
              </p>
            </div>

            {/* Upload Drop Zone Card */}
            <div className="bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void addFiles(e.dataTransfer.files);
                }}
                onClick={() => !validatingFiles && inputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
                  validatingFiles
                    ? "pointer-events-none opacity-70 border-border/60"
                    : dragOver
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border/60 bg-background/30 hover:border-primary/50 hover:bg-primary/5 hover:scale-[1.005]"
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  ref={inputRef}
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary shadow-md transition-transform duration-300 hover:scale-105">
                  {validatingFiles ? (
                    <Loader2 className="size-6 text-primary animate-spin" />
                  ) : (
                    <Upload className="size-6 text-primary animate-bounce" />
                  )}
                </div>
                <p className="text-base font-bold text-foreground">
                  {validatingFiles ? "Checking documents..." : "Drag & drop files here"}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground font-medium">
                  or click to browse from your computer
                </p>
                <p className="mt-3 text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">
                  PDF, DOC, DOCX · 10 MB total · {MAX_TOTAL_PAGES} pages total limit
                </p>
              </div>
            </div>

            {/* Selected Files Card */}
            {files.length > 0 && (
              <div className="space-y-4 bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center justify-between border-b border-border/30 pb-3">
                  <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary font-bold">
                      {files.length}
                    </span>
                    File{files.length !== 1 ? "s" : ""} Queued
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFiles([]);
                      setFilePages({});
                    }}
                    className="h-8 text-xs font-semibold text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl px-3"
                  >
                    Clear all
                  </Button>
                </div>
                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                  {files.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 px-4 py-3 shadow-sm group hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="size-4 shrink-0 text-primary transition-transform group-hover:scale-110" />
                        <span
                          className="truncate text-xs font-semibold text-foreground"
                          title={f.name}
                        >
                          {f.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {filePages[f.name] !== undefined && (
                          <span className="text-[10px] font-mono font-medium text-muted-foreground">
                            {filePages[f.name]} page{filePages[f.name] !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span className="text-[10px] font-mono font-medium text-muted-foreground">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(f.name);
                          }}
                          className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error alert */}
            {mutation.isError && (
              <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-xs font-semibold text-destructive shadow-sm">
                <AlertTriangle className="size-4 shrink-0" />
                {(mutation.error as Error).message}
              </div>
            )}

            {/* Action Button */}
            <div className="flex justify-end">
              <Button
                size="lg"
                onClick={handleProcess}
                disabled={files.length === 0 || mutation.isPending}
                className="bg-primary hover:bg-primary/95 text-white font-bold px-8 h-14 rounded-2xl text-base shadow-xl shadow-primary/10 w-full sm:w-auto transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <CloudUpload className="mr-2.5 size-5" />
                Process {files.length > 0 ? `${files.length} ` : ""}Document
                {files.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>

          {/* Right Column: Engine Details Panel */}
          <div className="lg:col-span-5 space-y-6 lg:mt-16">
            <div className="bg-surface/50 border border-border/40 p-6 rounded-3xl backdrop-blur-md shadow-xl space-y-5">
              <h3 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
                <Zap className="size-5 text-primary animate-pulse" /> Ingestion Pipeline
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                Each certificate is run through an advanced document classification and
                data-extraction sequence to build a structured equipment history.
              </p>

              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                    <FileText className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">1. AI-Powered Extraction</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Retrieve Customer Names, Sales Orders, Purchase Orders, and serial records
                      instantly with Azure AI Document Intelligence.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
                    <ShieldAlert className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">
                      2. High Accuracy OCR Engine
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Scanned or flat documents undergo robust Optical Character Recognition to
                      extract text layers and confirm data alignment.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-4 items-start p-4 rounded-2xl bg-background/40 border border-border/30 hover:border-primary/20 hover:bg-background/80 transition-all">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                    <Wrench className="size-4.5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">
                      3. Lifecycle Opportunity Matching
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      Verify certificate dates against corporate database rules to compute precise
                      service intervals and prompt upcoming recertifications.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate-confirmation popup — locked: admin MUST click one of the
          two footer buttons. Escape key, outside click, and the X close button
          are all disabled. */}
      <Dialog open={pendingDuplicates.length > 0}>
        <DialogContent
          className="sm:max-w-lg bg-surface border-border [&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-foreground flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              Possible duplicates detected
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {savedCount > 0 && (
                <span className="block mb-1 text-emerald-600 font-medium">
                  {savedCount} new record{savedCount !== 1 ? "s" : ""} saved.
                </span>
              )}
              {pendingDuplicates.length} uploaded file
              {pendingDuplicates.length !== 1 ? "s match" : " matches"} an existing record (same
              file or same customer + sales order + certificate date). Replace the existing record
              {pendingDuplicates.length !== 1 ? "s" : ""} or cancel the upload.
            </DialogDescription>
          </DialogHeader>

          <ul className="mt-2 max-h-[55vh] divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
            {pendingDuplicates.map((d) => (
              <li key={d.existingId + d.newRecommendation.id} className="p-3 space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Existing record
                  </p>
                  <p className="font-mono text-xs text-foreground truncate" title={d.existingFile}>
                    {d.existingFile}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {d.existingCustomer ?? "—"} · SO {d.existingSalesOrder ?? "—"} ·{" "}
                    {d.existingCertificateDate ?? "—"}
                  </p>
                </div>
                <div className="border-t border-border/30 pt-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    New upload
                  </p>
                  <p
                    className="font-mono text-xs text-foreground truncate"
                    title={d.newRecommendation.sourceFile}
                  >
                    {d.newRecommendation.sourceFile}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {confirmMutation.isError && (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {(confirmMutation.error as Error).message}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelDuplicates}
              disabled={confirmMutation.isPending}
            >
              Cancel upload
            </Button>
            <Button
              size="sm"
              disabled={confirmMutation.isPending}
              onClick={handleReplaceAll}
              className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold"
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Replacing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 size-4" />
                  Replace existing
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Blocked Files Modal */}
      <Dialog open={blockedFiles.length > 0} onOpenChange={(open) => !open && setBlockedFiles([])}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-foreground flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive animate-pulse" />
              {blockedFiles.every((f) => f.reason === "pages")
                ? `Documents Exceeded ${MAX_TOTAL_PAGES} Page Limit`
                : blockedFiles.every((f) => f.reason === "size")
                  ? "Files Exceeded 10MB Limit"
                  : "Some Files Could Not Be Added"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {blockedFiles.every((f) => f.reason === "pages")
                ? `The following files could not be added because they would exceed the total limit of ${MAX_TOTAL_PAGES} pages:`
                : blockedFiles.every((f) => f.reason === "size")
                  ? "The following files could not be added because they would exceed the total upload limit of 10 MB:"
                  : `The following files could not be added due to the 10 MB total size limit or the ${MAX_TOTAL_PAGES} page total limit:`}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 max-h-[40vh] divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40">
            {blockedFiles.map((f, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center gap-3 p-3 text-xs bg-background/50 hover:bg-background/80 transition-colors"
              >
                <span
                  className="font-mono text-foreground truncate max-w-[260px] font-semibold"
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="text-muted-foreground font-mono shrink-0">
                  {f.reason === "pages"
                    ? `${f.pages} pages`
                    : `${((f.size ?? 0) / 1024 / 1024).toFixed(2)} MB`}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => setBlockedFiles([])}
              className="bg-primary hover:bg-primary/90 text-white font-bold"
            >
              Acknowledge
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </>

  );
}
