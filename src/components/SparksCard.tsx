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
  first_day_reps: number;
}

export default function SparksCard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
    const text = `Join me on REPPs — we're on a mission to inspire 1,000,000 people to move more and live better. It starts with one repp. ${referralUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch { /* cancelled */ }
    } else {
      handleCopy();
    }
  };

  if (loading) return null;

  const totalPoints = sparks.reduce((sum, s) => sum + (s.points_awarded || 0), 0);

  return (
    <div className="bg-bg-surface rounded-lg overflow-hidden">
      {/* Header — always visible, tap to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-accent">
            <path d="M13 2L4.09 12.63a1 1 0 0 0 .78 1.62H11l-1 7.75L19.91 11.37a1 1 0 0 0-.78-1.62H13l1-7.75z" fill="currentColor" />
          </svg>
          <span className="text-headline text-purple-400 tabular-nums">{sparks.length}</span>
          <p className="text-body text-ink-muted">Sparks</p>
          {totalPoints > 0 && (
            <span className="text-caption text-ink-muted tabular-nums">· {totalPoints} pts</span>
          )}
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-4 pb-4">
          {sparks.length > 0 ? (
            <div className="flex flex-col gap-2">
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
                  <div className="flex items-center gap-2 text-right">
                    {s.first_day_reps > 0 && (
                      <span className="text-micro text-ink-muted tabular-nums">{s.first_day_reps} reps</span>
                    )}
                    <span className={`text-micro font-semibold tabular-nums ${
                      s.points_awarded > 0 ? "text-purple-400" : "text-ink-muted"
                    }`}>
                      {s.points_awarded > 0 ? `+${s.points_awarded}` : "Joined"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-caption text-ink-muted">
              Share your link to earn Sparks when people join!
            </p>
          )}

          <div className="mt-3 bg-accent/10 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="text-micro font-bold text-accent uppercase tracking-wide">2x Launch Bonus</span>
            </div>
            <p className="text-micro text-ink-secondary mt-0.5">
              <span className="text-purple-400 font-semibold">50 pts</span> per referral, <span className="text-purple-400 font-semibold">100 pts</span> if they hit 5 reps day one
            </p>
          </div>

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
      )}
    </div>
  );
}
