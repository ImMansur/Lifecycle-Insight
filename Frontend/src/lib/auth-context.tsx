import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { fetchUserRole } from "./api";

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
  signUp: (email: string, password: string, displayName: string, role: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Safety timeout: if Firebase doesn't respond in 6s, unblock the UI anyway
    const timeout = setTimeout(() => setLoading(false), 6000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timeout);
      setLoading(true);
      if (firebaseUser) {
        // Fetch role from Firestore directly for speed, fallback to API
        let role = "Uploader";
        try {
          const docRef = doc(db, "users", firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists() && docSnap.data().role) {
            role = docSnap.data().role;
          } else {
            const res = await fetchUserRole(firebaseUser.uid);
            role = res.role || "Uploader";
          }
        } catch (e) {
          console.error("Error fetching user profile directly, falling back to API:", e);
          try {
            const res = await fetchUserRole(firebaseUser.uid);
            role = res.role || "Uploader";
          } catch (e2) {
            console.error("API fallback also failed:", e2);
          }
        }

        localStorage.setItem("wom_user_role", role);

        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || "WOM User",
          photoURL: firebaseUser.photoURL,
          role: role,
        });

        // Log session login event once per browser session
        const sessionKey = `wom_login_logged_${firebaseUser.uid}`;
        if (!sessionStorage.getItem(sessionKey)) {
          sessionStorage.setItem(sessionKey, "true");
          const userName = firebaseUser.displayName || firebaseUser.email || "WOM User";
          import("./api").then(({ logActivityEvent }) => {
            logActivityEvent("LOGIN", `${userName} logged in`, {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: userName,
              role: role,
              userAgent: navigator.userAgent
            }).catch((err) => console.error("Failed to log login event:", err));
          });
        }
      } else {
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
      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string, role: string) => {
    const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);

    // Update the profile with the display name
    await updateProfile(firebaseUser, {
      displayName: displayName || "WOM User",
    });

    // Store profile in Firestore
    await setDoc(doc(db, "users", firebaseUser.uid), {
      role: role || "Uploader",
      email: firebaseUser.email,
      displayName: displayName || "WOM User",
    });

    setUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: displayName || "WOM User",
      photoURL: firebaseUser.photoURL,
      role: role || "Uploader",
    });
  };

  const signOut = async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      // Clear the session storage flag immediately so it is ALWAYS cleared on logout
      sessionStorage.removeItem(`wom_login_logged_${currentUser.uid}`);
      try {
        const { logActivityEvent } = await import("./api");
        const role = localStorage.getItem("wom_user_role") || "Uploader";
        const userName = currentUser.displayName || currentUser.email || "WOM User";
        await logActivityEvent("LOGOUT", `${userName} logged out`, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: userName,
          role: role
        });
      } catch (e) {
        console.error("Failed to log logout event:", e);
      }
    }
    localStorage.removeItem("wom_user_role");
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
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
