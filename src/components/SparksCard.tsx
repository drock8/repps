import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

interface Spark {
  referred_id: string;
  name: string;
  avatar_url: string | null;
  status: string;
  points_awarded: number;
  created_at: string;
  activated_at: string | null;
}

export default function SparksCard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const referralUrl = profile ? `https://repps.pro/r/${profile.referral_code}` : "";

  const fetchSparks = useCallback(async () => {
    const { data } = await supabase.rpc("get_my_sparks");
    if (data) setSparks(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSparks();
  }, [fetchSparks]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join REPPs",
          text: "Join me on REPPs — the global movement challenge!",
          url: referralUrl,
        });
      } catch { /* cancelled */ }
    } else {
      handleCopy();
    }
  };

  if (loading) return null;

  const totalPoints = sparks.reduce((sum, s) => sum + (s.points_awarded || 0), 0);

  return (
    <div className="bg-bg-surface rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-purple-400">
            <path d="M13 2L4.09 12.63a1 1 0 0 0 .78 1.62H11l-1 7.75L19.91 11.37a1 1 0 0 0-.78-1.62H13l1-7.75z" fill="currentColor" />
          </svg>
          <p className="text-micro text-ink-muted uppercase tracking-wide">Sparks</p>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-headline text-purple-400 tabular-nums">{sparks.length}</span>
          {totalPoints > 0 && (
            <span className="text-micro text-ink-muted tabular-nums">· {totalPoints} pts</span>
          )}
        </div>
      </div>

      {sparks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {sparks.map((s) => (
            <button
              key={s.referred_id}
              onClick={() => navigate(`/user/${s.referred_id}`)}
              className="flex items-center gap-3 py-1 transition-opacity active:opacity-70"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-avatar-bg">
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-caption font-bold text-avatar-text">
                      {s.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <span className="text-body text-ink-primary flex-1 text-left">{s.name}</span>
              <span className={`text-micro font-semibold ${
                s.status === "bonus_awarded" || s.status === "activated" ? "text-emerald-400" : "text-ink-muted"
              }`}>
                {s.status === "bonus_awarded" || s.status === "activated" ? "Active" : "Joined"}
              </span>
            </button>
          ))}
        </div>
      )}

      {sparks.length === 0 && (
        <p className="text-caption text-ink-muted mt-2">
          Share your link to earn Sparks when people join!
        </p>
      )}

      <div className="flex gap-3 mt-3">
        <button
          onClick={handleCopy}
          className="flex-1 bg-bg-elevated text-ink-primary font-semibold text-caption rounded-pill py-2.5 transition-all duration-200 ease-apple active:scale-95"
        >
          {copied ? "Copied!" : "Copy Link"}
        </button>
        <button
          onClick={handleShare}
          className="flex-1 bg-accent text-ink-inverse font-semibold text-caption rounded-pill py-2.5 transition-all duration-200 ease-apple active:scale-95"
        >
          Share
        </button>
      </div>
    </div>
  );
}
