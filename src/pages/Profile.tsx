import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth, type Gender } from "../contexts/AuthContext";
import { useRepsChannel } from "../hooks/useRepsChannel";
import { useResetCooldown } from "../hooks/useResetCooldown";
import ActivityHeatmap from "../components/ActivityHeatmap";
import PasswordInput from "../components/PasswordInput";

const genderOptions: { label: string; value: Gender }[] = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
  { label: "Prefer not to say", value: "unspecified" },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatRpm(reps: number, durationSeconds: number): string {
  if (durationSeconds === 0) return "—";
  return (reps / (durationSeconds / 60)).toFixed(1);
}

function formatGender(gender: Gender): string {
  if (gender === "non_binary") return "Non-binary";
  if (gender === "unspecified") return "Prefer not to say";
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

export default function Profile() {
  const navigate = useNavigate();
  const { profile, signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword, signOut, refreshProfile } = useAuth();

  const handleSignOut = useCallback(() => {
    navigate("/");
    signOut();
  }, [signOut, navigate]);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingGender, setEditingGender] = useState(false);
  const [savingGender, setSavingGender] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<{
    totalReps: number;
    daysActive: number;
    todayCount: number;
    bestSessionCount: number;
    bestSessionDuration: number;
    currentStreak: number;
    longestStreak: number;
  } | null>(null);
  const [dailyCounts, setDailyCounts] = useState<{ day: string; count: number }[]>([]);
  const [repScore, setRepScore] = useState<{ score: number; baseReps: number; individualStreak: number; teamStreak: number } | null>(null);

  // Guest auth form state
  const [authMode, setAuthMode] = useState<"choose" | "signup" | "signin" | "check-email" | "forgot" | "reset-sent">("choose");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const { cooldown: resetCooldown, startCooldown: startResetCooldown } = useResetCooldown();

  const fetchStats = useCallback(async () => {
    if (!profile) return;
    const [statsRes, dailyRes, scoreRes] = await Promise.all([
      supabase.rpc("get_user_stats_summary", { p_user_id: profile.id }),
      supabase.rpc("get_user_daily_counts", { p_user_id: profile.id }),
      supabase.rpc("calculate_user_rep_score", { p_user_id: profile.id, p_period: "all" }),
    ]);

    if (statsRes.data) {
      const row = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
      if (row) {
        setStats({
          totalReps: Number(row.total_reps),
          daysActive: Number(row.days_active),
          todayCount: Number(row.today_count),
          bestSessionCount: Number(row.best_session_count),
          bestSessionDuration: Number(row.best_session_duration),
          currentStreak: Number(row.current_streak),
          longestStreak: Number(row.longest_streak),
        });
      }
    }

    if (dailyRes.data) {
      setDailyCounts(
        (dailyRes.data as { day: string; count: number }[]).map((r) => ({
          day: r.day,
          count: Number(r.count),
        }))
      );
    }

    if (scoreRes.data) {
      const s = scoreRes.data as { score: number; base_reps: number; individual_streak: number; team_streak: number };
      setRepScore({
        score: Number(s.score),
        baseReps: Number(s.base_reps),
        individualStreak: Number(s.individual_streak),
        teamStreak: Number(s.team_streak),
      });
    }
  }, [profile]);

  useEffect(() => {
    fetchStats();

    function handleVisibility() {
      if (document.visibilityState === "visible") fetchStats();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchStats]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRepsChannel(
    useCallback(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchStats, 2000);
    }, [fetchStats])
  );
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Profile</p>
        <p className="text-body text-ink-secondary mb-8 text-center">
          Sign in to track your reps and claim your leaderboard spot
        </p>

        {authMode === "choose" && (
          <div className="w-full max-w-sm flex flex-col gap-3">
            <button
              onClick={signInWithGoogle}
              className="w-full py-4 px-6 rounded-pill bg-ink-primary text-ink-inverse font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              Sign up with Email
            </button>
            <button
              onClick={() => setAuthMode("signin")}
              className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
            >
              Already have an account? Sign in
            </button>
          </div>
        )}

        {authMode === "signup" && (
          <div className="w-full max-w-sm flex flex-col gap-3">
            <input
              type="text"
              placeholder="Name"
              value={authName}
              onChange={(e) => { setAuthName(e.target.value); setAuthError(""); }}
              maxLength={50}
              autoFocus
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => { setAuthEmail(e.target.value); setAuthError(""); }}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            <PasswordInput
              placeholder="Password (min 6 characters)"
              value={authPassword}
              onChange={(val) => { setAuthPassword(val); setAuthError(""); }}
            />
            {authError && <p className="text-caption text-error">{authError}</p>}
            <button
              onClick={async () => {
                if (!authName.trim() || !authEmail.trim() || !authPassword.trim()) {
                  setAuthError("All fields are required"); return;
                }
                if (authPassword.length < 6) {
                  setAuthError("Password must be at least 6 characters"); return;
                }
                setAuthSubmitting(true); setAuthError("");
                try {
                  const { confirmationRequired } = await signUpWithEmail(authEmail.trim(), authPassword, authName.trim());
                  if (confirmationRequired) {
                    setAuthMode("check-email");
                  }
                  setAuthSubmitting(false);
                } catch (e) {
                  setAuthError((e as Error).message);
                  setAuthSubmitting(false);
                }
              }}
              disabled={authSubmitting}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {authSubmitting ? "Creating account..." : "Sign up"}
            </button>
            <button
              onClick={() => { setAuthMode("signin"); setAuthError(""); }}
              className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
            >
              Already have an account? Sign in
            </button>
            <button
              onClick={() => { setAuthMode("choose"); setAuthError(""); }}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </div>
        )}

        {authMode === "signin" && (
          <div className="w-full max-w-sm flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => { setAuthEmail(e.target.value); setAuthError(""); }}
              autoFocus
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            <PasswordInput
              placeholder="Password"
              value={authPassword}
              onChange={(val) => { setAuthPassword(val); setAuthError(""); }}
            />
            {authError && <p className="text-caption text-error">{authError}</p>}
            <button
              onClick={async () => {
                if (!authEmail.trim() || !authPassword.trim()) {
                  setAuthError("Email and password are required"); return;
                }
                setAuthSubmitting(true); setAuthError("");
                try {
                  await signInWithEmail(authEmail.trim(), authPassword);
                } catch (e) {
                  setAuthError((e as Error).message);
                  setAuthSubmitting(false);
                }
              }}
              disabled={authSubmitting}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {authSubmitting ? "Signing in..." : "Sign in"}
            </button>
            <button
              onClick={() => { setAuthMode("forgot"); setAuthError(""); }}
              className="w-full py-2 text-caption text-ink-secondary text-center"
            >
              Forgot password?
            </button>
            <button
              onClick={() => { setAuthMode("signup"); setAuthError(""); }}
              className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
            >
              Don't have an account? Sign up
            </button>
            <button
              onClick={() => { setAuthMode("choose"); setAuthError(""); }}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </div>
        )}

        {authMode === "check-email" && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            <p className="text-headline text-ink-primary text-center">Check your email</p>
            <p className="text-body text-ink-secondary text-center">
              We sent a confirmation link to <span className="font-semibold text-ink-primary">{authEmail}</span>. Click the link to activate your account, then come back and sign in.
            </p>
            <button
              onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSubmitting(false); }}
              className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              Sign in
            </button>
            <button
              onClick={() => { setAuthMode("choose"); setAuthError(""); setAuthSubmitting(false); }}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </div>
        )}

        {authMode === "forgot" && (
          <div className="w-full max-w-sm flex flex-col gap-3">
            <p className="text-headline text-ink-primary text-center mb-2">Reset password</p>
            <p className="text-body text-ink-secondary text-center mb-2">
              Enter your email and we'll send you a reset link.
            </p>
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => { setAuthEmail(e.target.value); setAuthError(""); }}
              autoFocus
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            {authError && <p className="text-caption text-error">{authError}</p>}
            <button
              onClick={async () => {
                if (!authEmail.trim()) {
                  setAuthError("Email is required"); return;
                }
                if (resetCooldown > 0) return;
                setAuthSubmitting(true); setAuthError("");
                try {
                  await resetPassword(authEmail.trim());
                  startResetCooldown();
                  setAuthMode("reset-sent");
                  setAuthSubmitting(false);
                } catch (e) {
                  const msg = (e as Error).message || "";
                  if (msg.toLowerCase().includes("rate limit")) {
                    startResetCooldown();
                    setAuthError("Too many requests. Please wait before trying again.");
                  } else {
                    setAuthError(msg);
                  }
                  setAuthSubmitting(false);
                }
              }}
              disabled={authSubmitting || resetCooldown > 0}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {authSubmitting ? "Sending..." : resetCooldown > 0 ? `Wait ${resetCooldown}s` : "Send reset link"}
            </button>
            <button
              onClick={() => { setAuthMode("signin"); setAuthError(""); }}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Back to sign in
            </button>
          </div>
        )}

        {authMode === "reset-sent" && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            <p className="text-headline text-ink-primary text-center">Check your email</p>
            <p className="text-body text-ink-secondary text-center">
              We sent a password reset link to <span className="font-semibold text-ink-primary">{authEmail}</span>. Click the link to set a new password.
            </p>
            <button
              onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSubmitting(false); }}
              className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              Sign in
            </button>
            <button
              onClick={() => { setAuthMode("choose"); setAuthError(""); setAuthSubmitting(false); }}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </div>
        )}
      </div>
    );
  }

  const handleStartEditName = () => {
    setNameValue(profile.name);
    setNameError("");
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (trimmed.length > 50) {
      setNameError("Name must be 50 characters or less");
      return;
    }
    setSavingName(true);
    await supabase
      .from("profiles")
      .update({ name: trimmed })
      .eq("id", profile.id);
    await refreshProfile();
    setSavingName(false);
    setEditingName(false);
  };

  const handleSelectGender = async (gender: Gender) => {
    if (savingGender) return;
    setSavingGender(true);
    await supabase
      .from("profiles")
      .update({ gender, gender_set: true })
      .eq("id", profile.id);
    await refreshProfile();
    setSavingGender(false);
    setEditingGender(false);
  };

  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Only JPEG, PNG, WebP, and GIF images are allowed.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError("Image must be under 5 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploadingAvatar(true);
    const ext = file.name.split(".").pop();
    const path = `${profile.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      console.error("Avatar upload failed:", uploadError);
      setUploadingAvatar(false);
      return;
    }
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(path);
    const publicUrl = urlData.publicUrl + "?t=" + Date.now();
    await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", profile.id);
    await refreshProfile();
    setUploadingAvatar(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const memberSince = new Date(profile.created_at).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" }
  );

  return (
    <div className="flex flex-col overflow-y-auto pb-8">
      {/* Sign out icon top-right */}
      <div className="flex justify-end">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-ink-muted transition-colors duration-200 ease-apple active:text-ink-primary"
          title="Sign out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      {/* Avatar with camera edit icon */}
      <div className="flex justify-center mt-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative"
        >
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name}
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
              <span className="text-display-md text-ink-inverse">
                {profile.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-accent flex items-center justify-center shadow-lg">
            {uploadingAvatar ? (
              <div className="w-3.5 h-3.5 border-2 border-ink-inverse border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111315" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleAvatarUpload}
          className="hidden"
        />
      </div>
      {avatarError && (
        <p className="text-caption text-error text-center mt-2">{avatarError}</p>
      )}

      {/* Cards — consistent 2-unit gap */}
      <div className="flex flex-col gap-2 mt-4">
        {/* Name card */}
        {editingName ? (
          <div className="bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Name
            </p>
            <input
              type="text"
              value={nameValue}
              onChange={(e) => {
                setNameValue(e.target.value);
                setNameError("");
              }}
              maxLength={50}
              autoFocus
              className="w-full mt-2 bg-bg-input text-ink-primary text-headline rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            {nameError && (
              <p className="text-caption text-error mt-2">{nameError}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="flex-1 bg-accent text-ink-inverse font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="flex-1 bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartEditName}
            className="w-full text-left bg-bg-surface rounded-lg p-4 transition-colors duration-200 ease-apple active:bg-bg-elevated"
          >
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Name
            </p>
            <p className="text-headline mt-1">{profile.name}</p>
          </button>
        )}

        {/* Gender card */}
        {editingGender ? (
          <div className="bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Gender
            </p>
            <div className="flex flex-col gap-2 mt-3">
              {genderOptions.map((opt) => (
                <button
                  key={opt.value}
                  disabled={savingGender}
                  onClick={() => handleSelectGender(opt.value)}
                  className={`w-full py-3 px-4 rounded-pill text-body-lg font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50 ${
                    profile.gender === opt.value
                      ? "bg-accent text-ink-inverse"
                      : "bg-bg-elevated text-ink-primary hover:bg-bg-elevated/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setEditingGender(false)}
              className="w-full mt-3 bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingGender(true)}
            className="w-full text-left bg-bg-surface rounded-lg p-4 transition-colors duration-200 ease-apple active:bg-bg-elevated"
          >
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Gender
            </p>
            <p className="text-headline mt-1">{formatGender(profile.gender)}</p>
          </button>
        )}

        {/* Streak cards */}
        <div className="flex gap-2">
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Current Streak
            </p>
            <div className="flex items-baseline gap-1 mt-1">
              <p className="text-display-md text-accent tabular-nums">
                {stats ? stats.currentStreak : "—"}
              </p>
              <p className="text-caption text-ink-muted">
                {stats?.currentStreak === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Longest Streak
            </p>
            <div className="flex items-baseline gap-1 mt-1">
              <p className="text-display-md text-ink-primary tabular-nums">
                {stats ? stats.longestStreak : "—"}
              </p>
              <p className="text-caption text-ink-muted">
                {stats?.longestStreak === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
        </div>

        {/* Rep Score */}
        <div className="bg-bg-surface rounded-lg p-4">
          <p className="text-micro text-ink-muted uppercase tracking-wide">
            Rep Score
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-display-lg repps-gradient-text tabular-nums">
              {repScore ? repScore.score.toLocaleString() : "—"}
            </p>
            <p className="text-caption text-ink-muted">pts</p>
          </div>
          {repScore && repScore.score > 0 && (
            <div className="flex gap-3 mt-2">
              <span className="text-micro text-ink-secondary">
                {repScore.baseReps.toLocaleString()} base
              </span>
              {repScore.individualStreak > 0 && (
                <span className="text-micro text-accent">
                  {repScore.individualStreak}d streak
                </span>
              )}
              {repScore.teamStreak > 0 && (
                <span className="text-micro text-accent">
                  {repScore.teamStreak}d team
                </span>
              )}
            </div>
          )}
        </div>

        {/* Today + Total Reps */}
        <div className="flex gap-2">
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Today
            </p>
            <p className="text-display-md text-accent mt-1 tabular-nums">
              {stats ? stats.todayCount.toLocaleString() : "—"}
            </p>
          </div>
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Total Reps
            </p>
            <p className="text-display-md text-accent mt-1 tabular-nums">
              {stats ? stats.totalReps.toLocaleString() : "—"}
            </p>
          </div>
        </div>

        {/* Best Session + Days Active */}
        <div className="flex gap-2">
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Best Session
            </p>
            <div className="flex items-baseline gap-1 mt-1">
              <p className="text-display-md text-ink-primary tabular-nums">
                {stats ? stats.bestSessionCount : "—"}
              </p>
              <p className="text-caption text-ink-muted">reps</p>
            </div>
            {stats && stats.bestSessionDuration > 0 && (
              <p className="text-caption text-ink-muted mt-0.5">
                {formatDuration(stats.bestSessionDuration)} · {formatRpm(stats.bestSessionCount, stats.bestSessionDuration)}/min
              </p>
            )}
          </div>
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Days Active
            </p>
            <div className="flex items-baseline gap-1 mt-1">
              <p className="text-display-md text-ink-primary tabular-nums">
                {stats ? stats.daysActive : "—"}
              </p>
              <p className="text-caption text-ink-muted">
                {stats?.daysActive === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
        </div>

        {/* Member since */}
        <div className="bg-bg-surface rounded-lg p-4">
          <p className="text-micro text-ink-muted uppercase tracking-wide">
            Member Since
          </p>
          <p className="text-body mt-1">{memberSince}</p>
        </div>

        {/* Activity heatmap */}
        <ActivityHeatmap dailyCounts={dailyCounts} months={3} />
      </div>

      {/* Sign out button */}
      <div className="mt-6">
        <button
          onClick={handleSignOut}
          className="w-full bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 px-6 transition-all duration-200 ease-apple active:scale-95"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
