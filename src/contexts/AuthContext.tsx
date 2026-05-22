import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

export type Gender = "female" | "male" | "non_binary" | "unspecified";

export interface Profile {
  id: string;
  name: string;
  gender: Gender;
  gender_set: boolean;
  avatar_url: string | null;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
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
  await supabase
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
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (user: User) => {
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
    setProfile(p);
  };

  useEffect(() => {
    let settled = false;

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        settled = true;
        setSession(newSession);
        if (newSession?.user) {
          await loadProfile(newSession.user);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    // Fallback: if onAuthStateChange hasn't fired within 3s (mobile redirect
    // edge cases), explicitly check for a session and bootstrap from it.
    const fallbackTimer = setTimeout(async () => {
      if (settled) return;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        setSession(data.session);
        await loadProfile(data.session.user);
      }
      setLoading(false);
    }, 3000);

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session && !settled) {
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    const redirectTo = window.location.origin + "/";
    console.log("[auth] signInWithGoogle called, redirectTo:", redirectTo);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    console.log("[auth] signInWithOAuth result:", { data, error });
    if (error) {
      console.error("[auth] OAuth error:", error);
      throw error;
    }
  };

  const signOut = async () => {
    setSession(null);
    setProfile(null);
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Sign out error:", error);
  };

  const refreshProfile = async () => {
    if (session?.user) {
      const p = await fetchProfile(session.user.id);
      if (p) setProfile(p);
    }
  };

  const updateProfile = (fields: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...fields } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signInWithGoogle,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
