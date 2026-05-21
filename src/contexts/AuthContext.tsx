import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

export type Gender = "female" | "male" | "non_binary" | "unspecified";

export interface Profile {
  id: string;
  name: string;
  gender: Gender;
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
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        name: meta?.full_name || meta?.name || "Athlete",
        gender: "unspecified" as Gender,
        avatar_url: meta?.avatar_url || meta?.picture || null,
      },
      { onConflict: "id", ignoreDuplicates: true }
    )
    .select()
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
    }
    setProfile(p);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          await loadProfile(newSession.user);
        } else {
          setProfile(null);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
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
