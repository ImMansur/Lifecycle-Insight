import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import { useAuth, AuthProvider } from "@/lib/auth-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import { NotificationBell } from "@/components/wom/NotificationBell";
import { LoadingScreen } from "@/components/wom/LoadingScreen";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import "../styles.css";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          System Initialization Issue
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Retry System Boot
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const initials = (user.displayName ?? user.email ?? "A")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex items-center gap-3 px-3 py-2 rounded-2xl cursor-pointer border border-transparent hover:border-border/40 hover:bg-secondary/60 hover:shadow-sm transition-all focus:outline-none">
          <Avatar className="size-9 border border-border bg-primary/10 transition-transform group-hover:scale-105">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="hidden sm:flex flex-col text-left leading-tight">
            <div className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
              {user.displayName ?? "Admin"}
            </div>
            <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              {(user as any).role ?? "Fleet Manager"}
            </div>
          </div>
          <ChevronDown className="hidden sm:block size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-all group-hover:translate-y-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-surface border-border">
        <DropdownMenuLabel>
          <div className="font-semibold text-foreground truncate">
            {user.displayName ?? "Admin"}
          </div>
          <div className="text-xs text-muted-foreground font-normal truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-muted-foreground cursor-pointer">
          <User className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive cursor-pointer"
          onClick={onSignOut}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppLayout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const search = location.search as any;
  const navigate = useNavigate();
  const [showSignOutLoading, setShowSignOutLoading] = useState(false);

  const navItems = useMemo(() => {
    if (!user) return [];
    return [
      ...(user.role !== "Uploader"
        ? [{ id: "home", label: "Home", to: "/dashboard", search: { tab: "Home" } }]
        : []),
      ...(user.role !== "Uploader"
        ? [{ id: "records", label: "Records", to: "/records" }]
        : []),
      ...(user.role !== "Analysis" ? [{ id: "upload", label: "Upload", to: "/upload" }] : []),
      ...(user.role !== "Uploader"
        ? [{ id: "action-center", label: "Action Center", to: "/action-center" }]
        : []),
      ...(user.role !== "Uploader" && user.role !== "Analysis" ? [{ id: "logs", label: "Logs & Savings", to: "/logs" }] : []),
      ...(user.role !== "Uploader"
        ? [
            {
              id: "rules",
              label: "Lifecycle Rules",
              to: "/dashboard",
              search: { tab: "Lifecycle Rules" },
            },
          ]
        : []),
      ...(user.role === "Fleet Manager" || user.role === "System Administrator"
        ? [{ id: "users", label: "Users", to: "/users" }]
        : []),
    ];
  }, [user]);

  const [coords, setCoords] = useState({ left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    if (!user) return;

    const updateCoords = () => {
      const activeItem = navItems.find((item) => {
        if (item.to !== location.pathname) return false;
        if (item.search && item.search.tab !== (search.tab || "Home")) return false;
        return true;
      });

      if (activeItem && itemRefs.current[activeItem.id] && containerRef.current) {
        const el = itemRefs.current[activeItem.id];
        if (el) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          setCoords({
            left: elRect.left - containerRect.left,
            width: elRect.width,
          });
        }
      }
    };

    updateCoords();

    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("resize", updateCoords);
    };
  }, [location.pathname, search.tab, navItems, user]);

  const isAuthPage = location.pathname === "/login" || location.pathname === "/";

  if (showSignOutLoading) {
    return (
      <LoadingScreen
        title="WOM"
        subtitle="Lifecycle"
        statusText="Closing Secure Session"
        subStatusText="Terminating Connection..."
        onFinished={async () => {
          await signOut();
          setShowSignOutLoading(false);
          navigate({ to: "/login" });
        }}
      />
    );
  }

  if (loading) {
    if (!isAuthPage) {
      return (
        <LoadingScreen
          title="WOM"
          subtitle="Lifecycle"
          statusText="Initializing Environment"
          subStatusText="Secure Handshake..."
        />
      );
    }
  }

  if (isAuthPage || !user) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 flex flex-col relative">
        {/* Fixed Background Layers */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-mesh" />
          <div className="absolute inset-0 bg-grid opacity-30" />
        </div>

        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl relative">
          <div className="mx-auto flex h-20 max-w-[1600px] items-center gap-8 px-6">
            <div className="flex items-center gap-5">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-primary/20 bg-white shadow-xl shadow-primary/10 transition-all hover:scale-110 hover:shadow-primary/20">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent" />
                <img
                  src="/logo.png"
                  alt="WOM Logo"
                  className="relative z-10 size-full object-contain p-1.5"
                />
              </div>
              <div className="leading-tight">
                <div className="font-display text-lg font-black tracking-tight text-accent">
                  WOM <span className="text-primary">Lifecycle</span>
                </div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/80">
                  Worldwide Oilfield Machine
                </div>
              </div>
            </div>

            <nav
              ref={containerRef}
              className="relative mx-auto hidden items-center gap-1 rounded-full bg-secondary/80 p-1.5 backdrop-blur-sm md:flex"
            >
              {coords.width > 0 && (
                <div
                  className="absolute top-1.5 bottom-1.5 bg-primary rounded-full transition-all duration-300 ease-in-out shadow-md shadow-primary/25"
                  style={{
                    left: `${coords.left}px`,
                    width: `${coords.width}px`,
                  }}
                />
              )}

              {navItems.map((item) => {
                const active =
                  item.to === location.pathname &&
                  (!item.search || item.search.tab === (search.tab || "Home"));

                return (
                  <Link
                    key={item.id}
                    to={item.to}
                    search={item.search}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      if (containerRef.current) {
                        const containerRect = containerRef.current.getBoundingClientRect();
                        const elRect = el.getBoundingClientRect();
                        setCoords({
                          left: elRect.left - containerRect.left,
                          width: elRect.width,
                        });
                      }
                    }}
                    ref={(el) => {
                      itemRefs.current[item.id] = el;
                    }}
                    className={cn(
                      "relative z-10 rounded-full px-6 py-2 text-sm font-semibold transition-colors duration-300",
                      active ? "text-white" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-6">
              <div className="hidden sm:flex items-center gap-2">
                <NotificationBell />
              </div>
              <div className="h-8 w-px bg-border/50 hidden sm:block" />
              <div className="flex items-center gap-3">
                <UserMenu onSignOut={() => setShowSignOutLoading(true)} />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col relative z-10">
          <Outlet />
        </main>
      </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationsProvider>
          <AppLayout />
        </NotificationsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
