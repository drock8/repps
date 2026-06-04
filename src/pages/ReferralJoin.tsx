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

export default function ReferralJoin() {
  const { code } = useParams<{ code: string }>();
  const { profile, loading } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (code) storeReferralCode(code);
  }, [code]);

  // If already logged in, create the referral immediately instead of just redirecting
  useEffect(() => {
    if (!profile || !code || claiming || done) return;
    setClaiming(true);
    (async () => {
      try { await supabase.rpc("create_referral", { p_referral_code: code.toUpperCase() }); } catch { /* ignore */ }
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

  if (profile && done) return <Navigate to="/home" replace />;
  if (profile && claiming) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not logged in — send to landing for signup
  return <Navigate to="/" replace />;
}
