import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, createUser, deleteUser, type UserProfile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Users,
  Plus,
  Trash2,
  Shield,
  Info,
  Lock,
  Mail,
  User,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";

export const Route = createFileRoute("/users")({
  component: UsersPage,
});

// UserMenu component moved to __root.tsx layout wrapper

function UsersPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  const getInitials = (name: string) => {
    if (!name) return "";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarStyles = (role: string) => {
    switch (role) {
      case "Developer":
        return "bg-[#EEF2FF] text-[#4F46E5] border border-[#E0E7FF]";
      case "Fleet Manager":
      case "System Administrator":
        return "bg-[#FFF0EB] text-[#FF7235] border border-[#FFE4D9]";
      case "Analysis":
        return "bg-[#EAFDF4] text-[#10B981] border border-[#D1FAE5]";
      case "Uploader":
      default:
        return "bg-[#FEF7E0] text-[#D97706] border border-[#FDE68A]";
    }
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("Analysis");
  const [formError, setFormError] = useState<string | null>(null);

  // Direct access check
  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: "/login" });
      } else if (user.role === "Developer") {
        navigate({ to: "/developer" });
      } else if (user.role !== "Fleet Manager" && user.role !== "System Administrator") {
        // Redirect non-admins out of user management
        if (user.role === "Uploader") {
          navigate({ to: "/upload" });
        } else {
          navigate({ to: "/dashboard" });
        }
      }
    }
  }, [user, loading, navigate]);

  const {
    data: users = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: !!user && (user.role === "Fleet Manager" || user.role === "System Administrator" || user.role === "Developer"),
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      addNotification({
        fileName: "User Management",
        status: "success",
        message: `Registered new user: ${newUser.displayName}`,
      });
      // Reset form
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("Analysis");
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      addNotification({
        fileName: "User Management",
        status: "success",
        message: `Deleted user: ${userToDelete?.displayName}`,
      });
      setUserToDelete(null);
      setDeleteConfirmOpen(false);
    },
    onError: (err: Error) => {
      addNotification({
        fileName: "User Management",
        status: "error",
        message: `Delete failed: ${err.message}`,
      });
    },
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !password || !displayName.trim()) {
      setFormError("All fields are required.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    createMutation.mutate({
      email: email.trim(),
      password,
      displayName: displayName.trim(),
      role,
    });
  };

  const handleDeleteUser = () => {
    if (userToDelete) {
      deleteMutation.mutate(userToDelete.uid);
    }
  };

  if (loading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const displayedUsers = users.filter(u => u.role !== "Developer");

  const sortedUsers = [...displayedUsers].sort((a, b) => {
    if (a.email === "admin@womgroup.com") return -1;
    if (b.email === "admin@womgroup.com") return 1;
    const aIsSelf = a.uid === user?.uid;
    const bIsSelf = b.uid === user?.uid;
    if (aIsSelf) return -1;
    if (bIsSelf) return 1;
    return (a.displayName || "").localeCompare(b.displayName || "");
  });

  return (
    <div className="flex-1 max-w-[1600px] w-full mx-auto p-6 md:p-8 space-y-8 relative z-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1">
            Add and configure access credentials and system permission roles.
          </p>
        </div>
        <Button
          onClick={() => {
            setFormError(null);
            setDisplayName("");
            setEmail("");
            setPassword("");
            setRole("Analysis");
            setCreateOpen(true);
          }}
          className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-5 h-12 rounded-xl shadow-lg shadow-accent/10"
        >
          <Plus className="mr-2 size-4" /> Add System User
        </Button>
      </div>

      {/* Roles Explanation UI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Fleet Manager */}
        <div className="bg-white dark:bg-slate-900 border border-border/60 p-6 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-200 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center size-12 rounded-2xl bg-[#FFF3EE] border border-[#FFE4D9] text-[#FF7235] shrink-0">
              <Shield className="size-6 text-[#FF7235]" />
            </div>
            <div className="leading-tight">
              <h3 className="font-bold text-lg text-foreground">Fleet Manager</h3>
              <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#FF7235]">
                FULL ADMIN CONTROL
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Full administrative privileges. Can view dashboard analytics, upload and review
            Certificates of Conformance, manage actions in the Action Center, edit lifecycle rules,
            and create or delete other system users.
          </p>
        </div>

        {/* Card 2: Analysis */}
        <div className="bg-white dark:bg-slate-900 border border-border/60 p-6 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-200 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center size-12 rounded-2xl bg-[#EAFDF4] border border-[#D1FAE5] text-[#10B981] shrink-0">
              <Info className="size-6 text-[#10B981]" />
            </div>
            <div className="leading-tight">
              <h3 className="font-bold text-lg text-foreground">Analysis</h3>
              <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#10B981]">
                READ & EDIT WORKFLOW
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Read-and-write workflow privileges. Can view dashboard metrics, edit extracted CoC
            details, manage items in the Action Center, and review lifecycle recommendations.{" "}
            <strong>Restricted from uploading new documents.</strong>
          </p>
        </div>

        {/* Card 3: Uploader */}
        <div className="bg-white dark:bg-slate-900 border border-border/60 p-6 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-200 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center size-12 rounded-2xl bg-[#FEF7E0] border border-[#FDE68A] text-[#D97706] shrink-0">
              <UserPlus className="size-6 text-[#D97706]" />
            </div>
            <div className="leading-tight">
              <h3 className="font-bold text-lg text-foreground">Uploader</h3>
              <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#D97706]">
                STRICTLY INGESTION
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Strictly ingestion privileges. Can access the upload screen to import CoC files.{" "}
            <strong>
              Restricted from viewing the dashboard, edit recommendation logs, and action center
              data.
            </strong>
          </p>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 border border-border/40 rounded-[32px] overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-border/10 flex items-center justify-between">
          <h2 className="font-display font-bold text-xl flex items-center gap-2">
            <Users className="size-5 text-[#FF7235]" /> Active System Credentials
          </h2>
          <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 px-3 py-1 rounded-full font-bold">
            {displayedUsers.length} Account{displayedUsers.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border/10 bg-slate-50/50 dark:bg-slate-900/30">
                <th className="p-4 pl-6 font-bold text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  Name
                </th>
                <th className="p-4 font-bold text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  Email Address
                </th>
                <th className="p-4 font-bold text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  System Role
                </th>
                <th className="p-4 pr-6 font-bold text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    No system users registered.
                  </td>
                </tr>
              ) : (
                sortedUsers.map((u) => {
                  const isSelf = u.uid === user?.uid;
                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group"
                    >
                      <td className="p-4 pl-6 font-semibold text-foreground flex items-center gap-3">
                        <div className="relative shrink-0">
                          <div
                            className={`size-10 rounded-full flex items-center justify-center font-bold text-sm tracking-wide border ${getAvatarStyles(
                              u.role,
                            )}`}
                          >
                            {getInitials(u.displayName || "")}
                          </div>
                          <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {u.displayName}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] font-black tracking-widest text-[#FF7235] uppercase mt-0.5">
                              CURRENT SESSION
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-slate-500 dark:text-slate-400 font-sans text-sm">
                        {u.email}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                            u.role === "Developer"
                              ? "bg-[#EEF2FF] border-[#E0E7FF] text-[#4F46E5]"
                              : u.role === "Fleet Manager" || u.role === "System Administrator"
                                ? "bg-[#FFF0EB] border-[#FFE4D9] text-[#FF7235]"
                                : u.role === "Analysis"
                                  ? "bg-[#EAFDF4] border-[#D1FAE5] text-[#10B981]"
                                  : "bg-[#FEF7E0] border-[#FDE68A] text-[#D97706]"
                          }`}
                        >
                          <Shield className="size-3" /> {u.role}
                        </span>
                      </td>
                      <td className="p-4 pr-6 text-right">
                        {!isSelf ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setUserToDelete(u);
                              setDeleteConfirmOpen(true);
                            }}
                            className="rounded-xl h-9 px-3 text-slate-400 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                            title="Delete user credentials"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : (
                          <div className="h-9 w-10 ml-auto" />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl md:max-w-[950px] bg-[#F1F3F5] dark:bg-slate-900 border-none p-6 md:p-8 rounded-[32px] overflow-y-auto max-h-[90vh] shadow-2xl">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#FF7235] to-[#FF9B4D] rounded-t-[32px]" />

          <DialogHeader className="flex flex-row items-center gap-4 space-y-0 text-left border-b border-border/10 pb-4 mt-2">
            <div className="flex items-center justify-center size-12 rounded-2xl bg-[#FFF3EE] border border-[#FFE4D9] text-[#FF7235] shrink-0">
              <UserPlus className="size-6 text-[#FF7235]" />
            </div>
            <div>
              <DialogTitle className="font-display text-2xl font-bold text-foreground">
                Register System Credentials
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-0.5">
                Provide corporate details and assign an authorization role.
              </DialogDescription>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-5 pt-3" autoComplete="off">
            {formError && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Column 1: Account Details */}
              <div className="space-y-3.5">
                {/* Section Title */}
                <div className="flex items-center gap-2 text-[#FF7235] font-display font-bold text-[11px] uppercase tracking-[0.15em] mb-4">
                  <User className="size-4 text-[#FF7235]" />
                  <span>1. Account Details</span>
                </div>

                {/* Input 1: Full Name */}
                <div className="space-y-1">
                  <Label
                    htmlFor="create-name"
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
                  >
                    Full Name
                  </Label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      id="create-name"
                      type="text"
                      placeholder="e.g. John Doe"
                      required
                      className="pl-11 h-12 bg-white dark:bg-slate-950 border-none focus-visible:ring-2 focus-visible:ring-primary/20 text-sm rounded-[16px] shadow-sm"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Input 2: Corporate Email */}
                <div className="space-y-1">
                  <Label
                    htmlFor="create-email"
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
                  >
                    Corporate Email
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      id="create-email"
                      type="email"
                      placeholder="name@womgroup.com"
                      required
                      autoComplete="new-password"
                      className="pl-11 h-12 bg-white dark:bg-slate-950 border-none focus-visible:ring-2 focus-visible:ring-primary/20 text-sm rounded-[16px] shadow-sm"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* Input 3: Initial Password */}
                <div className="space-y-1">
                  <Label
                    htmlFor="create-password"
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80"
                  >
                    Initial Password
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      id="create-password"
                      type="password"
                      placeholder="Minimum 8 characters"
                      required
                      autoComplete="new-password"
                      className="pl-11 h-12 bg-white dark:bg-slate-950 border-none focus-visible:ring-2 focus-visible:ring-primary/20 text-sm rounded-[16px] shadow-sm"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Column 2: Access Authorization */}
              <div className="space-y-3.5">
                {/* Section Title */}
                <div className="flex items-center gap-2 text-[#FF7235] font-display font-bold text-[11px] uppercase tracking-[0.15em] mb-4">
                  <Shield className="size-4 text-[#FF7235]" />
                  <span>2. Access Authorization</span>
                </div>

                {/* Role Selection Cards */}
                <div className="space-y-2.5">
                  {/* Fleet Manager Card */}
                  <button
                    type="button"
                    onClick={() => setRole("Fleet Manager")}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all duration-200 flex gap-4 relative cursor-pointer ${
                      role === "Fleet Manager"
                        ? "bg-white dark:bg-slate-950 border-[#10B981] dark:border-emerald-500 shadow-md ring-1 ring-[#10B981]/15"
                        : "bg-[#EAEDF0] dark:bg-slate-800/40 border-transparent hover:bg-white/60 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-10 rounded-full shrink-0 ${
                        role === "Fleet Manager"
                          ? "bg-[#ECFDF5] text-[#10B981] dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "border border-muted-foreground/20 text-muted-foreground/60 bg-[#EAEDF0] dark:bg-slate-800"
                      }`}
                    >
                      <Shield className="size-5" />
                    </div>
                    <div className="pr-6 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">Fleet Manager</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#FFF0EB] text-[#FF7235] border border-[#FFE4D9]">
                          ADMIN
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Full administrative control. View analytics, upload/review Certificates of
                        Conformance (CoC), manage lifecycle rules, and configure system credentials.
                      </p>
                    </div>
                    {role === "Fleet Manager" && (
                      <div className="absolute top-4 right-4 size-5 rounded-full border-2 border-[#10B981] bg-white flex items-center justify-center shrink-0">
                        <div className="size-2 rounded-full bg-[#10B981]" />
                      </div>
                    )}
                  </button>

                  {/* Analysis Card */}
                  <button
                    type="button"
                    onClick={() => setRole("Analysis")}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all duration-200 flex gap-4 relative cursor-pointer ${
                      role === "Analysis"
                        ? "bg-white dark:bg-slate-950 border-[#10B981] dark:border-emerald-500 shadow-md ring-1 ring-[#10B981]/15"
                        : "bg-[#EAEDF0] dark:bg-slate-800/40 border-transparent hover:bg-white/60 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-10 rounded-full shrink-0 ${
                        role === "Analysis"
                          ? "bg-[#ECFDF5] text-[#10B981] dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "border border-muted-foreground/20 text-muted-foreground/60 bg-[#EAEDF0] dark:bg-slate-800"
                      }`}
                    >
                      <Info className="size-5" />
                    </div>
                    <div className="pr-6 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">Analysis</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#EAFDF4] text-[#10B981] border border-[#D1FAE5]">
                          WORKFLOW
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Read & edit access. View dashboard metrics, edit extracted CoC details,
                        action task lists, and review lifecycle recommendations. Cannot upload
                        documents.
                      </p>
                    </div>
                    {role === "Analysis" && (
                      <div className="absolute top-4 right-4 size-5 rounded-full border-2 border-[#10B981] bg-white flex items-center justify-center shrink-0">
                        <div className="size-2 rounded-full bg-[#10B981]" />
                      </div>
                    )}
                  </button>

                  {/* Uploader Card */}
                  <button
                    type="button"
                    onClick={() => setRole("Uploader")}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all duration-200 flex gap-4 relative cursor-pointer ${
                      role === "Uploader"
                        ? "bg-white dark:bg-slate-950 border-[#10B981] dark:border-emerald-500 shadow-md ring-1 ring-[#10B981]/15"
                        : "bg-[#EAEDF0] dark:bg-slate-800/40 border-transparent hover:bg-white/60 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-10 rounded-full shrink-0 ${
                        role === "Uploader"
                          ? "bg-[#ECFDF5] text-[#10B981] dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "border border-muted-foreground/20 text-muted-foreground/60 bg-[#EAEDF0] dark:bg-slate-800"
                      }`}
                    >
                      <UserPlus className="size-5" />
                    </div>
                    <div className="pr-6 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">Uploader</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#FEF7E0] text-[#D97706] border border-[#FDE68A]">
                          INGESTION
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Strictly ingestion access. Access the upload page to import new CoC files.
                        Restricted from viewing the dashboard, edit logs, or managing other users.
                      </p>
                    </div>
                    {role === "Uploader" && (
                      <div className="absolute top-4 right-4 size-5 rounded-full border-2 border-[#10B981] bg-white flex items-center justify-center shrink-0">
                        <div className="size-2 rounded-full bg-[#10B981]" />
                      </div>
                    )}
                  </button>


                </div>
              </div>
            </div>

            {/* Footer / Buttons */}
            <div className="border-t border-border/10 pt-4 flex justify-end gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
                className="bg-white hover:bg-slate-50 border-none text-[#4A5568] font-bold h-12 px-6 rounded-2xl shadow-sm cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold h-12 px-8 rounded-2xl shadow-lg shadow-primary/20 cursor-pointer transition-all duration-200"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin animate-infinite" /> Registering…
                  </>
                ) : (
                  "Create Credentials"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" /> Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Are you sure you want to delete the user credentials for{" "}
              <strong className="text-foreground">{userToDelete?.displayName}</strong> (
              {userToDelete?.email})? This will immediately revoke their access to the system.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-3">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={handleDeleteUser}
              className="bg-destructive hover:bg-destructive/95 text-destructive-foreground font-bold"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Deleting…
                </>
              ) : (
                "Confirm Delete"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
