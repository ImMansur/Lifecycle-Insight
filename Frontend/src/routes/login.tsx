import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingScreen } from "@/components/wom/LoadingScreen";
import {
  Lock,
  Mail,
  ChevronRight,
  Globe,
  ShieldCheck,
  User,
  Briefcase,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchRecommendations, fetchActions } from "@/lib/api";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [barFinished, setBarFinished] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signIn, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      if (!isLoading || barFinished) {
        if (user.role === "Uploader") {
          navigate({ to: "/upload" });
        } else {
          navigate({ to: "/dashboard" });
        }
      }
    }
  }, [user, loading, isLoading, barFinished, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      await signIn(email, password);
      // Credentials confirmed — now switch to full-screen loading.
      // Kick off data prefetch in parallel so it's cached when the dashboard mounts.
      queryClient.prefetchQuery({ queryKey: ["recommendations"], queryFn: fetchRecommendations });
      queryClient.prefetchQuery({ queryKey: ["actions"], queryFn: fetchActions });
      setIsLoading(true);
    } catch (err: unknown) {
      setIsSubmitting(false); // re-enable button so the user can retry
      const message = (err as Error).message || "";
      if (message.includes("Invalid email or password")) {
        setError("Invalid email or password.");
      } else {
        setError(message || "Something went wrong. Please try again.");
      }
    }
  };

  if (isLoading) return <LoadingScreen onFinished={() => setBarFinished(true)} />;

  return (
    <div className="relative min-h-screen bg-background flex flex-col lg:flex-row overflow-hidden">
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] size-[50%] rounded-full bg-primary/5 blur-[150px] animate-float" />
        <div className="absolute top-[30%] -right-[10%] size-[45%] rounded-full bg-accent/5 blur-[120px] animate-float-delayed" />
        <div className="absolute inset-0 bg-grid opacity-20" />
      </div>

      {/* Left branding panel */}
      <div className="relative z-10 w-full lg:w-[45%] xl:w-[40%] flex flex-col justify-between p-10 lg:p-14 bg-accent text-accent-foreground overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-grid invert opacity-5" />
          <div className="absolute top-0 right-0 size-[500px] bg-primary rounded-full blur-[120px] -translate-y-1/3 translate-x-1/3 opacity-30" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-5 mb-10">
            <div className="size-16 rounded-2xl bg-white p-2.5 shadow-2xl transition-transform hover:scale-105">
              <img src="/logo.png" alt="WOM Logo" className="size-full object-contain" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-2xl font-black tracking-tight text-white">
                WOM <span className="text-primary italic">Lifecycle</span>
              </div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
                Worldwide Oilfield Machine
              </div>
            </div>
          </div>
          <h1 className="font-display text-5xl xl:text-7xl font-black tracking-tight leading-[0.95] mb-8">
            Industrial <span className="text-primary italic">Intelligence</span> Reimagined.
          </h1>
          <p className="text-xl text-white/60 leading-relaxed max-w-md font-medium mb-2">
            Next-generation proactive lifecycle management for global oilfield operations.
          </p>
        </div>
        <div className="relative z-10 mt-12 lg:mt-0 flex flex-col gap-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
            <div className="flex items-center gap-4 text-sm font-bold text-white/90">
              <div className="size-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <ShieldCheck className="size-6 text-primary" />
              </div>
              Multi-Factor Authentication
            </div>
            <div className="flex items-center gap-4 text-sm font-bold text-white/90">
              <div className="size-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <Globe className="size-6 text-primary" />
              </div>
              Global Service Network
            </div>
          </div>
          <div className="pt-10 border-t border-white/10 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/30">
              WOM_SECURE_GATEWAY_v4.2
            </div>
            <div className="flex gap-4 text-white/30 text-xs font-bold uppercase tracking-widest">
              <span>Security</span>
              <span>Privacy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="relative z-10 flex-1 flex flex-col justify-center items-center p-8 lg:p-20 bg-background/50 backdrop-blur-sm">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-4 mb-12">
            <div className="size-12 rounded-xl bg-white p-2.5 shadow-xl">
              <img src="/logo.png" alt="WOM Logo" className="size-full object-contain" />
            </div>
            <div className="font-display text-xl font-black tracking-tight text-accent">
              WOM <span className="text-primary italic">Lifecycle</span>
            </div>
          </div>

          <div className="mb-10">
            <h2 className="text-4xl font-black tracking-tight text-accent mb-3">Gateway Access</h2>
            <p className="text-muted-foreground font-medium text-lg">
              Enter your credentials to manage lifecycle assets.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <Label
                htmlFor="email"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Corporate Email
              </Label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  id="email"
                  type="email"
                  placeholder="identity@womgroup.com"
                  required
                  className="pl-12 h-14 bg-white border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all text-base rounded-2xl shadow-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label
                htmlFor="password"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
              >
                Password
              </Label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••••"
                  required
                  className="pl-12 h-14 bg-white border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all text-base rounded-2xl shadow-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-16 bg-primary hover:bg-primary/90 text-primary-foreground text-xl font-black tracking-tight rounded-2xl shadow-2xl shadow-primary/30 group relative overflow-hidden disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center justify-center">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>
                      Establish Connection
                      <ChevronRight className="ml-2 size-6 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
              </Button>
            </div>
          </form>

          <div className="mt-10 pt-8 border-t border-border/30 flex items-center justify-center">
            <p className="text-[10px] text-muted-foreground/70 font-bold uppercase tracking-widest text-center">
              © 2026 Worldwide Oilfield Machine. All Rights Reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
