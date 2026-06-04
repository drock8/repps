import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

const REFERRAL_CODE_KEY = "repps_referral_code";

export function storeReferralCode(code: string) {
  try { localStorage.setItem(REFERRAL_CODE_KEY, code.toUpperCase()); } catch { /* ignore */ }
}

export function consumeReferralCode(): string | null {
  try {
    const code = localStorage.getItem(REFERRAL_CODE_KEY);
    if (code) localStorage.removeItem(REFERRAL_CODE_KEY);
    return code;
  } catch { return null; }
}

async function claimReferral(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_referral", { p_referral_code: code.toUpperCase() });
  if (error) return `rpc_error: ${error.message}`;
  if (data && typeof data === "object" && "error" in data) return `referral_error: ${(data as Record<string, string>).error}`;
  return "success";
}

export default function ReferralJoin() {
  const { code } = useParams<{ code: string }>();
  const { profile, loading } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (code) storeReferralCode(code);
  }, [code]);

  useEffect(() => {
    if (!profile || !code || claiming || done) return;
    setClaiming(true);
    (async () => {
      const res = await claimReferral(code);
      console.log("[referral] create_referral result:", res, "code:", code, "user:", profile.name);
      setResult(res);
      consumeReferralCode();
      setDone(true);
    })();
  }, [profile, code, claiming, done]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (profile && done) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-bg-base gap-4">
        <p className="text-body text-ink-secondary">
          {result === "success" ? "Referral linked!" : `Debug: ${result}`}
        </p>
        <Navigate to="/home" replace />
      </div>
    );
  }

  if (profile && claiming) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <Navigate to="/" replace />;
}
