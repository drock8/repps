import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { getGuestSession, clearGuestSession } from "../lib/guestSession";
import type { Session, User } from "@supabase/supabase-js";

export type Gender = "female" | "male" | "non_binary" | "unspecified";

export interface Profile {
  id: string;
  name: string;
  gender: Gender;
  gender_set: boolean;
  avatar_url: string | null;
  created_at: string;
  team_id: string | null;
  team_joined_at: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ confirmationRequired: boolean }>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (fields: Partial<Profile>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

async function ensureProfile(user: User): Promise<Profile> {
  const meta = user.user_metadata;
  const { error: upsertError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        name: meta?.full_name || meta?.name || "Athlete",
        gender: "unspecified" as Gender,
        avatar_url: meta?.avatar_url || meta?.picture || null,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
  if (upsertError) throw upsertError;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}

async function claimGuestReps(userId: string): Promise<void> {
  const guest = getGuestSession();
  if (!guest?.repIds?.length) return;

  await supabase
    .from("reps")
    .update({ user_id: userId })
    .in("id", guest.repIds)
    .is("user_id", null);

  if (guest.gender && guest.gender !== "unspecified") {
    await supabase
      .from("profiles")
      .update({ gender: guest.gender, gender_set: true })
      .eq("id", userId);
  }

  clearGuestSession();
}

// --- Module-level PKCE code extraction (runs once, before React) ---
// Captures the ?code= param and strips it from the URL immediately.
// This prevents React StrictMode's double-mount from losing the code.
let _codeExchangePromise: ReturnType<typeof supabase.auth.exchangeCodeForSession> | null = null;
let _isRecoveryFromUrl = false;

(() => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("type") === "recovery") {
    _isRecoveryFromUrl = true;
  }
  if (code) {
    url.searchParams.delete("code");
    url.searchParams.delete("type");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    _codeExchangePromise = supabase.auth.exchangeCodeForSession(code);
  }
})();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const loadProfile = useCallback(async (user: User) => {
    let p = await fetchProfile(user.id);
    if (!p) {
      p = await ensureProfile(user);
    } else {
      const meta = user.user_metadata;
      const googleAvatar = meta?.avatar_url || meta?.picture || null;
      if (googleAvatar && !p.avatar_url) {
        await supabase
          .from("profiles")
          .update({ avatar_url: googleAvatar })
          .eq("id", p.id);
        p = { ...p, avatar_url: googleAvatar };
      }
    }

    await claimGuestReps(user.id);
    const refreshed = await fetchProfile(user.id);
    if (refreshed) p = refreshed;

    setProfile(p);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let bootstrapped = false;

    async function bootstrap(s: Session | null) {
      if (cancelled || bootstrapped) return;
      bootstrapped = true;
      setSession(s);
      try {
        if (s?.user) {
          await loadProfile(s.user);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("[auth] profile load failed:", e);
        setProfile(null);
      }
      if (!cancelled) setLoading(false);
    }

    // Safety timeout: if auth never resolves (e.g. Android redirect lost), unblock UI
    const timeout = setTimeout(() => {
      if (!bootstrapped && !cancelled) {
        console.warn("[auth] bootstrap timeout — unblocking UI");
        supabase.auth.getSession().then(({ data }) => bootstrap(data.session));
      }
    }, 8000);

    // Subscribe to auth state changes FIRST so we never miss PASSWORD_RECOVERY
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === "PASSWORD_RECOVERY") {
          setPasswordRecovery(true);
        }
        bootstrap(newSession);
      }
    );

    if (_codeExchangePromise) {
      _codeExchangePromise.then(({ data, error }) => {
        if (error || !data.session) {
          // Code exchange failed (e.g. PKCE verifier lost on Android Chrome Custom Tabs)
          console.warn("[auth] code exchange failed, falling back to getSession:", error?.message);
          supabase.auth.getSession().then(({ data: d }) => bootstrap(d.session));
          return;
        }
        const redirectType = (data as Record<string, unknown>).redirectType;
        if (redirectType === "recovery" || _isRecoveryFromUrl) {
          setPasswordRecovery(true);
        }
        // Always bootstrap from the exchange result — onAuthStateChange may not fire
        // reliably on Android (Chrome Custom Tabs can lose context)
        bootstrap(data.session);
      });
    } else {
      // No code param — bootstrap from existing session
      supabase.auth.getSession().then(({ data }) => {
        bootstrap(data.session);
      });
    }

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = window.location.origin + "/";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string): Promise<{ confirmationRequired: boolean }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) throw error;
    if (data.session && data.user) {
      await ensureProfile({ ...data.user, user_metadata: { ...data.user.user_metadata, full_name: name } } as User);
      await claimGuestReps(data.user.id);
      return { confirmationRequired: false };
    }
    return { confirmationRequired: true };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/?type=recovery",
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setPasswordRecovery(false);
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false);
  }, []);

  const signOut = useCallback(async () => {
    setSession(null);
    setProfile(null);
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Sign out error:", error);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      const p = await fetchProfile(session.user.id);
      if (p) setProfile(p);
    }
  }, [session]);

  const updateProfile = useCallback((fields: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...fields } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    passwordRecovery,
    clearPasswordRecovery,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    resetPassword,
    updatePassword,
    signOut,
    refreshProfile,
    updateProfile,
  }), [session, profile, loading, passwordRecovery, clearPasswordRecovery, signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword, updatePassword, signOut, refreshProfile, updateProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
