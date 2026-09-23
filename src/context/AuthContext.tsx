import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { getUserProfile } from "../firebase/firestore";
import { signOut, subscribeToAuth } from "../firebase/auth";
import type { UserProfile } from "../types/user";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAuth(async (nextUser) => {
      setUser(nextUser);
      setProfileError(null);

      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const nextProfile = await getUserProfile(nextUser.uid);
        if (!nextProfile) {
          setProfile(null);
          setProfileError("Kullanıcı profili bulunamadı. Yönetici Firestore'da kullanıcı kaydını oluşturmalı.");
        } else if (!nextProfile.active) {
          await signOut();
          setProfile(null);
          setProfileError("Kullanıcı hesabı pasif durumda.");
        } else {
          setProfile(nextProfile);
        }
      } catch {
        setProfile(null);
        setProfileError("Kullanıcı profili yüklenemedi.");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    profileError,
    logout: () => signOut(),
  }), [user, profile, loading, profileError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth AuthProvider içinde kullanılmalıdır.");
  return context;
}
