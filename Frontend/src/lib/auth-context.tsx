import React, { createContext, useContext, useEffect, useState } from "react";
import { apiLogin, apiLogout, fetchCurrentUser } from "./api";

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await fetchCurrentUser();
        if (!cancelled && me) {
          localStorage.setItem("wom_user_role", me.role);
          setUser({
            uid: me.uid,
            email: me.email,
            displayName: me.displayName || "WOM User",
            photoURL: null,
            role: me.role,
          });
        }
      } catch {
        // No active session — that's fine, user stays logged out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const me = await apiLogin(email, password);
    localStorage.setItem("wom_user_role", me.role);
    setUser({
      uid: me.uid,
      email: me.email,
      displayName: me.displayName || "WOM User",
      photoURL: null,
      role: me.role,
    });

    // Log session login event once per browser session
    const sessionKey = `wom_login_logged_${me.uid}`;
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, "true");
      const userName = me.displayName || me.email || "WOM User";
      import("./api").then(({ logActivityEvent }) => {
        logActivityEvent("LOGIN", `${userName} logged in`, {
          uid: me.uid,
          email: me.email,
          displayName: userName,
          role: me.role,
          userAgent: navigator.userAgent,
        }).catch((err) => console.error("Failed to log login event:", err));
      });
    }
  };

  const signOut = async () => {
    if (user) {
      sessionStorage.removeItem(`wom_login_logged_${user.uid}`);
      try {
        const { logActivityEvent } = await import("./api");
        const userName = user.displayName || user.email || "WOM User";
        await logActivityEvent("LOGOUT", `${userName} logged out`, {
          uid: user.uid,
          email: user.email,
          displayName: userName,
          role: user.role,
        });
      } catch (e) {
        console.error("Failed to log logout event:", e);
      }
    }
    localStorage.removeItem("wom_user_role");
    try {
      await apiLogout();
    } finally {
      setUser(null);
      // Clear all login session flags in sessionStorage when logged out
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("wom_login_logged_")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
