import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface FileUploadProgress {
  name: string;
  progress: number;
  substatus: string;
}

const PIPELINE_STEPS = [
  { label: "Upload", threshold: 0 },
  { label: "Compress", threshold: 15 },
  { label: "Extract", threshold: 35 },
  { label: "Analyze", threshold: 65 },
] as const;

function getActiveStepIndex(progress: number): number {
  let active = 0;
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    if (progress >= PIPELINE_STEPS[i].threshold) active = i;
  }
  return active;
}

export function LoadingScreen({
  onFinished,
  progressValue,
  title = "WOM",
  subtitle = "Lifecycle",
  statusText = "Initializing Environment",
  subStatusText = "Secure Handshake...",
  fileProgress = [],
}: {
  onFinished?: () => void;
  progressValue?: number;
  title?: string;
  subtitle?: string;
  statusText?: string;
  subStatusText?: string;
  fileProgress?: FileUploadProgress[];
}) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const maxProgressRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tracked = progressValue !== undefined;

  const onFinishedRef = useRef(onFinished);
  const finishedCalledRef = useRef(false);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    if (tracked && progressValue !== undefined) {
      maxProgressRef.current = Math.max(maxProgressRef.current, progressValue);
    }
  }, [tracked, progressValue]);

  useEffect(() => {
    return () => {
      maxProgressRef.current = 0;
      finishedCalledRef.current = false;
    };
  }, []);

  const activeStep = getActiveStepIndex(
    tracked ? Math.max(maxProgressRef.current, progressValue ?? 0) : displayProgress,
  );
  const shownProgress = tracked
    ? Math.max(maxProgressRef.current, progressValue ?? 0)
    : displayProgress;

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    if (tracked) return;

    timerRef.current = setInterval(() => {
      setDisplayProgress((prev) => {
        if (prev >= 100) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (!finishedCalledRef.current) {
            finishedCalledRef.current = true;
            onFinishedRef.current?.();
          }
          return 100;
        }
        return prev + (Math.random() * 20 + 5);
      });
    }, 120);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tracked]);

  const showFileList = fileProgress.length > 1;

  const content = (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background px-4">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] size-[40%] rounded-full bg-primary/5 blur-[120px] animate-float" />
        <div className="absolute top-[20%] -right-[5%] size-[35%] rounded-full bg-accent/5 blur-[100px] animate-float-delayed" />
        <div className="absolute inset-0 bg-grid opacity-30" />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <div className="relative mb-8 size-24">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <div className="absolute inset-2 flex animate-pulse items-center justify-center rounded-full bg-white p-3 shadow-xl">
            <img src="/logo.png" alt="WOM Logo" className="size-full object-contain" />
          </div>
        </div>

        <div className="w-full">
          <div className="mb-2 flex items-end justify-between">
            <div className="leading-tight">
              <div className="font-display text-sm font-black tracking-tight text-accent">
                {title} <span className="text-primary">{subtitle}</span>
              </div>
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                {statusText}
              </div>
            </div>
            <div className="font-mono text-xs font-bold text-primary">
              {Math.min(100, Math.round(shownProgress))}%
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, shownProgress)}%` }}
            />
          </div>
        </div>

        {tracked && (
          <div className="mt-5 flex w-full items-center justify-between gap-1">
            {PIPELINE_STEPS.map((step, i) => {
              const isDone = i < activeStep || shownProgress >= 100;
              const isActive = i === activeStep && shownProgress < 100;
              return (
                <div key={step.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border text-[9px] font-bold transition-colors duration-300",
                      isDone && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
                      isActive && "border-primary bg-primary/10 text-primary",
                      !isDone && !isActive && "border-border/60 bg-muted/20 text-muted-foreground/50",
                    )}
                  >
                    {isDone ? <CheckCircle2 className="size-3" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "font-mono text-[8px] font-bold uppercase tracking-wider",
                      isActive && "text-primary",
                      isDone && "text-emerald-600",
                      !isDone && !isActive && "text-muted-foreground/40",
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex max-w-full items-center gap-2 text-muted-foreground/70">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="truncate font-mono text-[10px] uppercase tracking-widest">
            {subStatusText}
          </span>
        </div>

        {showFileList && (
          <div className="mt-5 max-h-36 w-full space-y-2 overflow-y-auto rounded-xl border border-border/40 bg-background/60 p-3">
            {fileProgress.map((file) => (
              <div key={file.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate font-mono text-[10px] font-semibold text-foreground"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                    {file.progress}%
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-[width] duration-500 ease-out"
                    style={{ width: `${Math.min(100, file.progress)}%` }}
                  />
                </div>
                {file.substatus && file.progress < 100 && (
                  <p className="truncate font-mono text-[9px] text-muted-foreground/60">
                    {file.substatus}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
