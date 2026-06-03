import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/format";
import { PRESET_MESSAGES, PRESET_KEYS } from "../lib/presets";
import { useAuth } from "../contexts/AuthContext";

interface PublicProfileData {
  user_id: string;
  name: string;
  avatar_url: string | null;
  gender: string | null;
  created_at: string;
  total_reps: number;
  streak: number;
  rep_score: number;
  team_id: string | null;
  team_name: string | null;
  nudged_today: boolean;
  is_blocked: boolean;
}

export default function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [data, setData] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPresets, setShowPresets] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudged, setNudged] = useState(false);
  const [toast, setToast] = useState("");
  const [blocking, setBlocking] = useState(false);

  // Redirect to own profile
  useEffect(() => {
    if (profile && id === profile.id) {
      navigate("/profile", { replace: true });
    }
  }, [profile, id, navigate]);

  const fetchProfile = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: result } = await supabase.rpc("get_public_profile", { p_user_id: id });
    if (result?.success) {
      setData(result);
      setNudged(result.nudged_today);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleNudge = async () => {
    if (!id || nudged || nudging) return;
    setNudging(true);
    const { data: result } = await supabase.rpc("send_nudge", { p_recipient_id: id });
    if (result?.success) {
      setNudged(true);
      showToast("Nudge sent!");
    } else if (result?.error === "already_nudged_today") {
      setNudged(true);
    }
    setNudging(false);
  };

  const handleSendPreset = async (key: string) => {
    if (!id) return;
    setShowPresets(false);
    const { data: result } = await supabase.rpc("send_message", {
      p_recipient_id: id,
      p_message_key: key,
    });
    if (result?.success) {
      navigate(`/inbox/${result.conversation_id}`);
    }
  };

  const handleBlock = async () => {
    if (!id || blocking) return;
    if (!window.confirm(`Block ${data?.name}? You won't see their messages.`)) return;
    setBlocking(true);
    const { data: result } = await supabase.rpc("block_user", { p_user_id: id });
    if (result?.success) {
      showToast("User blocked");
      navigate(-1);
    }
    setBlocking(false);
  };

  const handleUnblock = async () => {
    if (!id || blocking) return;
    setBlocking(true);
    const { data: result } = await supabase.rpc("unblock_user", { p_user_id: id });
    if (result?.success) {
      showToast("User unblocked");
      await fetchProfile();
    }
    setBlocking(false);
  };

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <p className="text-headline text-ink-primary mb-2">User not found</p>
        <button onClick={() => navigate(-1)} className="text-caption text-accent">
          Go back
        </button>
      </div>
    );
  }

  const memberSince = new Date(data.created_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  const genderLabel: Record<string, string> = {
    female: "Female",
    male: "Male",
    non_binary: "Non-binary",
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-caption text-ink-secondary self-start mb-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* Avatar + name */}
      <div className="flex flex-col items-center mb-6">
        <div className="w-20 h-20 rounded-full overflow-hidden mb-3">
          {data.avatar_url ? (
            <img src={data.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-avatar-bg flex items-center justify-center">
              <span className="text-display-md font-bold text-avatar-text">
                {data.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <p className="text-headline text-ink-primary">{data.name}</p>
        <p className="text-caption text-ink-secondary mt-0.5">
          {data.gender && genderLabel[data.gender] ? `${genderLabel[data.gender]} · ` : ""}
          Joined {memberSince}
        </p>
      </div>

      {/* Stats card */}
      <div className="bg-bg-surface rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-display-sm text-accent font-bold tabular-nums">{formatNumber(data.total_reps)}</p>
            <p className="text-micro text-ink-muted uppercase tracking-wide">Total Reps</p>
          </div>
          <div className="text-center">
            <p className="text-display-sm text-accent font-bold tabular-nums">{formatNumber(Math.round(data.rep_score))}</p>
            <p className="text-micro text-ink-muted uppercase tracking-wide">Rep Score</p>
          </div>
          <div className="text-center">
            <p className="text-display-sm text-ink-primary font-bold tabular-nums">{data.streak}</p>
            <p className="text-micro text-ink-muted uppercase tracking-wide">Streak (days)</p>
          </div>
          <div className="text-center">
            {data.team_name ? (
              <button
                onClick={() => navigate("/team")}
                className="text-display-sm text-accent font-bold truncate max-w-full"
              >
                {data.team_name} →
              </button>
            ) : (
              <p className="text-display-sm text-ink-muted font-bold">—</p>
            )}
            <p className="text-micro text-ink-muted uppercase tracking-wide">Team</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {profile && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setShowPresets(true)}
            className="flex-1 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Message
          </button>
          <button
            onClick={handleNudge}
            disabled={nudged || nudging}
            className={`flex-1 py-4 rounded-pill font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 ${
              nudged
                ? "bg-bg-elevated text-ink-secondary"
                : "bg-bg-elevated text-ink-primary"
            }`}
          >
            {nudged ? "Nudged ✓" : nudging ? "..." : "Nudge 👊"}
          </button>
        </div>
      )}

      {/* Block/unblock */}
      {profile && (
        <div className="text-center">
          {data.is_blocked ? (
            <button
              onClick={handleUnblock}
              disabled={blocking}
              className="text-caption text-ink-muted"
            >
              Unblock {data.name}
            </button>
          ) : (
            <button
              onClick={handleBlock}
              disabled={blocking}
              className="text-caption text-ink-muted"
            >
              Block user
            </button>
          )}
        </div>
      )}

      {/* Preset message picker modal */}
      {showPresets && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPresets(false); }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPresets(false)} />
          <div
            className="relative w-full max-w-md bg-bg-surface rounded-t-xl px-4 pt-4 pb-6 animate-slide-up"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <p className="text-body text-ink-primary font-semibold text-center mb-4">Send a message</p>
            <div className="flex flex-col gap-2">
              {PRESET_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => handleSendPreset(key)}
                  className="w-full py-3 px-4 bg-bg-elevated rounded-lg text-body text-ink-primary text-left transition-all duration-200 ease-apple active:scale-[0.98]"
                >
                  {PRESET_MESSAGES[key]}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPresets(false)}
              className="w-full mt-3 py-3 text-caption text-ink-muted text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-bg-surface text-ink-primary text-caption font-semibold px-4 py-2 rounded-pill shadow-lg animate-[fadeIn_200ms_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
