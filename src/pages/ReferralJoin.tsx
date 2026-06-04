import { useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

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

  useEffect(() => {
    if (code) storeReferralCode(code);
  }, [code]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Already logged in — code is stored, AuthContext will consume it on next bootstrap
  if (profile) return <Navigate to="/home" replace />;

  // Not logged in — send to landing for signup
  return <Navigate to="/" replace />;
}
