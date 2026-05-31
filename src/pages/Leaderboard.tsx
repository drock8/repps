import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useRepsChannel } from "../hooks/useRepsChannel";
import PasswordInput from "../components/PasswordInput";

type GenderFilter = "all" | "female" | "male" | "non_binary";
type TimePeriod = "daily" | "weekly" | "monthly" | "yearly" | "all";
type BoardType = "total" | "session" | "streak";

interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  createdAt: string;
}

interface SessionEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  repCount: number;
  durationSeconds: number;
}

interface StreakEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  longestStreak: number;
  currentStreak: number;
}

const BOARD_TABS: { label: string; value: BoardType }[] = [
  { label: "Total Reps", value: "total" },
  { label: "Best Session", value: "session" },
  { label: "Streaks", value: "streak" },
];

const GENDER_TABS: { label: string; value: GenderFilter }[] = [
  { label: "All", value: "all" },
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
];

const TIME_TABS: { label: string; value: TimePeriod }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
  { label: "All", value: "all" },
];

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-accent text-ink-inverse flex items-center justify-center text-caption font-bold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function SignupOverlay({
  reps,
  onDismiss,
}: {
  reps: number;
  onDismiss: () => void;
}) {
  const { signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<"choose" | "signup" | "signin" | "check-email" | "forgot" | "reset-sent">("choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const t = setTimeout(() => setResetCooldown(resetCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [resetCooldown]);

  const handleEmailSignup = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("All fields are required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const { confirmationRequired } = await signUpWithEmail(email.trim(), password, name.trim());
      if (confirmationRequired) {
        setMode("check-email");
      }
      setSubmitting(false);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  const handleEmailSignin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await signInWithEmail(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />
      <div className="relative w-full max-w-md bg-bg-surface rounded-t-xl px-6 pt-6 pb-8 animate-slide-up"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        {mode === "choose" && (
          <>
            <div className="flex justify-center mb-4">
              <span className="bg-accent/20 text-accent font-bold text-caption rounded-pill px-4 py-1.5">
                +{reps} VERIFIED {reps === 1 ? "REP" : "REPS"}
              </span>
            </div>
            <p className="text-headline text-ink-primary text-center">
              Lock in your spot
            </p>
            <p className="text-body text-ink-secondary text-center mt-2">
              Sign up to lock in your spot
            </p>
            <div className="flex flex-col gap-3 mt-6">
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
                onClick={() => setMode("signup")}
                className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                Sign up with Email
              </button>
            </div>
            <button
              onClick={onDismiss}
              className="w-full mt-4 py-2 text-body text-ink-secondary text-center transition-colors duration-200 ease-apple"
            >
              Maybe later
            </button>
          </>
        )}

        {mode === "signup" && (
          <>
            <p className="text-headline text-ink-primary text-center mb-6">
              Create your account
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                maxLength={50}
                autoFocus
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
              <PasswordInput
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(val) => { setPassword(val); setError(""); }}
              />
              {error && <p className="text-caption text-error">{error}</p>}
              <button
                onClick={handleEmailSignup}
                disabled={submitting}
                className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {submitting ? "Creating account..." : "Sign up"}
              </button>
            </div>
            <button
              onClick={() => { setMode("signin"); setError(""); }}
              className="w-full mt-3 py-2 text-caption text-ink-secondary text-center"
            >
              Already have an account? Sign in
            </button>
            <button
              onClick={() => { setMode("choose"); setError(""); }}
              className="w-full mt-1 py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </>
        )}

        {mode === "signin" && (
          <>
            <p className="text-headline text-ink-primary text-center mb-6">
              Welcome back
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                autoFocus
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
              <PasswordInput
                placeholder="Password"
                value={password}
                onChange={(val) => { setPassword(val); setError(""); }}
              />
              {error && <p className="text-caption text-error">{error}</p>}
              <button
                onClick={handleEmailSignin}
                disabled={submitting}
                className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </div>
            <button
              onClick={() => { setMode("forgot"); setError(""); }}
              className="w-full mt-3 py-2 text-caption text-ink-secondary text-center"
            >
              Forgot password?
            </button>
            <button
              onClick={() => { setMode("signup"); setError(""); }}
              className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
            >
              Don't have an account? Sign up
            </button>
            <button
              onClick={() => { setMode("choose"); setError(""); }}
              className="w-full mt-1 py-2 text-caption text-ink-muted text-center"
            >
              Back
            </button>
          </>
        )}

        {mode === "check-email" && (
          <>
            <div className="flex flex-col items-center gap-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              <p className="text-headline text-ink-primary text-center">Check your email</p>
              <p className="text-body text-ink-secondary text-center">
                We sent a confirmation link to <span className="font-semibold text-ink-primary">{email}</span>. Click the link to activate your account, then come back and sign in.
              </p>
              <button
                onClick={() => { setMode("signin"); setError(""); setSubmitting(false); }}
                className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
              >
                Sign in
              </button>
              <button
                onClick={() => { setMode("choose"); setError(""); setSubmitting(false); }}
                className="w-full py-2 text-caption text-ink-muted text-center"
              >
                Back
              </button>
            </div>
          </>
        )}

        {mode === "forgot" && (
          <>
            <p className="text-headline text-ink-primary text-center mb-2">Reset password</p>
            <p className="text-body text-ink-secondary text-center mb-4">
              Enter your email and we'll send you a reset link.
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                autoFocus
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
              {error && <p className="text-caption text-error">{error}</p>}
              <button
                onClick={async () => {
                  if (!email.trim()) {
                    setError("Email is required"); return;
                  }
                  if (resetCooldown > 0) return;
                  setSubmitting(true); setError("");
                  try {
                    await resetPassword(email.trim());
                    setMode("reset-sent");
                    setSubmitting(false);
                  } catch (e) {
                    const msg = (e as Error).message || "";
                    if (msg.toLowerCase().includes("rate limit")) {
                      setResetCooldown(60);
                      setError("Too many requests. Please wait a minute before trying again.");
                    } else {
                      setError(msg);
                    }
                    setSubmitting(false);
                  }
                }}
                disabled={submitting || resetCooldown > 0}
                className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {submitting ? "Sending..." : resetCooldown > 0 ? `Wait ${resetCooldown}s` : "Send reset link"}
              </button>
            </div>
            <button
              onClick={() => { setMode("signin"); setError(""); }}
              className="w-full mt-3 py-2 text-caption text-ink-muted text-center"
            >
              Back to sign in
            </button>
          </>
        )}

        {mode === "reset-sent" && (
          <>
            <div className="flex flex-col items-center gap-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              <p className="text-headline text-ink-primary text-center">Check your email</p>
              <p className="text-body text-ink-secondary text-center">
                We sent a password reset link to <span className="font-semibold text-ink-primary">{email}</span>. Click the link to set a new password.
              </p>
              <button
                onClick={() => { setMode("signin"); setError(""); setSubmitting(false); }}
                className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
              >
                Sign in
              </button>
              <button
                onClick={() => { setMode("choose"); setError(""); setSubmitting(false); }}
                className="w-full py-2 text-caption text-ink-muted text-center"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { profile, signInWithGoogle } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const signupFlow = searchParams.get("signup") === "1";
  const signupGender = searchParams.get("gender") as GenderFilter | null;
  const signupReps = parseInt(searchParams.get("reps") || "0", 10);

  const [boardType, setBoardType] = useState<BoardType>("total");
  const [gender, setGender] = useState<GenderFilter>(
    signupGender && ["female", "male", "non_binary"].includes(signupGender)
      ? signupGender
      : "all"
  );
  const [period, setPeriod] = useState<TimePeriod>(signupFlow ? "daily" : "all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
  const [streakEntries, setStreakEntries] = useState<StreakEntry[]>([]);
  const [totalReps, setTotalReps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userEntry, setUserEntry] = useState<{
    rank: number;
    entry: LeaderboardEntry;
  } | null>(null);
  const [showSignup, setShowSignup] = useState(signupFlow && !profile);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (profile && showSignup) {
      setShowSignup(false);
      setSearchParams({}, { replace: true });
    }
  }, [profile, showSignup, setSearchParams]);

  const fetchTotalReps = useCallback(async () => {
    const { count } = await supabase
      .from("reps")
      .select("*", { count: "exact", head: true });
    if (count !== null) setTotalReps(count);
  }, []);

  const fetchLeaderboard = useCallback(
    async (g: GenderFilter, p: TimePeriod) => {
      setLoading(true);

      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_gender: g === "all" ? null : g,
        p_period: p,
        p_limit: 50,
      });

      if (error) {
        console.error("Leaderboard query error:", error);
        setEntries([]);
        setUserEntry(null);
        setLoading(false);
        return;
      }

      const top50: LeaderboardEntry[] = (data || []).map(
        (row: { user_id: string; name: string; avatar_url: string | null; rep_count: number; created_at: string }) => ({
          userId: row.user_id,
          name: row.name,
          avatarUrl: row.avatar_url,
          count: row.rep_count,
          createdAt: row.created_at,
        })
      );

      setEntries(top50);

      if (profile) {
        const userMatchesFilter = g === "all" || profile.gender === g;

        if (userMatchesFilter) {
          const userInTop50 = top50.some((e) => e.userId === profile.id);
          if (!userInTop50) {
            const { data: rankData } = await supabase.rpc("get_user_rank", {
              p_user_id: profile.id,
              p_gender: g === "all" ? null : g,
              p_period: p,
            });
            const row = Array.isArray(rankData) ? rankData[0] : rankData;
            const rank = row?.rank ? Number(row.rank) : top50.length + 1;
            const userInList = top50.find((e) => e.userId === profile.id);
            setUserEntry({
              rank,
              entry: userInList ?? {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                count: 0,
                createdAt: profile.created_at,
              },
            });
          } else {
            setUserEntry(null);
          }
        } else {
          setUserEntry(null);
        }
      } else {
        setUserEntry(null);
      }

      setLoading(false);
    },
    [profile]
  );

  const fetchSessionLeaderboard = useCallback(
    async (g: GenderFilter) => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_best_session_leaderboard", {
        p_gender: g === "all" ? null : g,
        p_limit: 50,
      });
      if (error) {
        console.error("Session leaderboard error:", error);
        setSessionEntries([]);
        setLoading(false);
        return;
      }
      setSessionEntries(
        (data || []).map((row: { user_id: string; name: string; avatar_url: string | null; rep_count: number; duration_seconds: number }) => ({
          userId: row.user_id,
          name: row.name,
          avatarUrl: row.avatar_url,
          repCount: Number(row.rep_count),
          durationSeconds: Number(row.duration_seconds),
        }))
      );
      setLoading(false);
    },
    []
  );

  const fetchStreakLeaderboard = useCallback(
    async (g: GenderFilter) => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_streak_leaderboard", {
        p_gender: g === "all" ? null : g,
        p_limit: 50,
      });
      if (error) {
        console.error("Streak leaderboard error:", error);
        setStreakEntries([]);
        setLoading(false);
        return;
      }
      setStreakEntries(
        (data || []).map((row: { out_user_id: string; out_name: string; out_avatar_url: string | null; out_longest_streak: number; out_current_streak: number }) => ({
          userId: row.out_user_id,
          name: row.out_name,
          avatarUrl: row.out_avatar_url,
          longestStreak: Number(row.out_longest_streak),
          currentStreak: Number(row.out_current_streak),
        }))
      );
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    fetchTotalReps();
    if (boardType === "total") {
      fetchLeaderboard(gender, period);
    } else if (boardType === "session") {
      fetchSessionLeaderboard(gender);
    } else {
      fetchStreakLeaderboard(gender);
    }
  }, [gender, period, boardType, fetchLeaderboard, fetchSessionLeaderboard, fetchStreakLeaderboard, fetchTotalReps]);

  useRepsChannel(
    useCallback(() => {
      setTotalReps((prev) => prev + 1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (boardType === "total") fetchLeaderboard(gender, period);
        else if (boardType === "session") fetchSessionLeaderboard(gender);
        else fetchStreakLeaderboard(gender);
      }, 2000);
    }, [gender, period, boardType, fetchLeaderboard, fetchSessionLeaderboard, fetchStreakLeaderboard])
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const guestPosition = signupFlow && !profile && signupReps > 0
    ? entries.findIndex((e) => e.count <= signupReps)
    : -1;

  function formatSessionDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  const isEmpty =
    boardType === "total"
      ? entries.length === 0 && !userEntry
      : boardType === "session"
        ? sessionEntries.length === 0
        : streakEntries.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.24)-theme(spacing.12))]">
      <div className="flex-shrink-0 bg-bg-base">
        <div className="relative flex flex-col items-center mt-2 mb-4">
          <img
            src="/Leaderboard-Mascot-Repps.png"
            alt=""
            className="absolute w-[4.5rem] left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <p className="text-headline text-ink-primary">GBT</p>
          <p className="text-display-lg repps-gradient-text mt-1 tabular-nums">
            {formatNumber(totalReps)}
          </p>
          <p className="text-micro text-ink-secondary uppercase tracking-wide mt-1">
            Global Burpee Total
          </p>
        </div>

        {/* Board type tabs */}
        <div className="flex gap-1 mb-3 bg-bg-surface rounded-pill p-1">
          {BOARD_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setBoardType(tab.value)}
              className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                boardType === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 mb-3">
          {GENDER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setGender(tab.value)}
              className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                gender === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {boardType === "total" && (
          <div className="flex gap-1 mb-4">
            {TIME_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setPeriod(tab.value)}
                className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                  period === tab.value
                    ? "bg-accent text-ink-inverse font-bold"
                    : "bg-transparent text-ink-secondary font-medium"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
      {loading ? (
        <div className="py-12 text-center">
          <p className="text-body text-ink-muted">Loading...</p>
        </div>
      ) : isEmpty ? (
        <div className="py-12 text-center">
          <p className="text-body text-ink-muted">
            No activity yet in this category. Be the first.
          </p>
        </div>
      ) : boardType === "total" ? (
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => {
            const isGuestInsertPoint = guestPosition === i;
            return (
              <div key={entry.userId}>
                {isGuestInsertPoint && (
                  <div className="flex items-center py-3 px-4 bg-bg-surface rounded-lg mb-2 border-l-4 border-accent shadow-[0_0_16px_2px_rgba(255,155,47,0.15)]">
                    <span className="w-8 text-center flex-shrink-0">
                      <span className="text-micro text-accent font-bold">You</span>
                    </span>
                    <div className="ml-2">
                      <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                    </div>
                    <span className="ml-3 text-body text-accent truncate flex-1 font-semibold">
                      Your reps
                    </span>
                    <span className="text-body text-accent font-bold tabular-nums ml-2">
                      {signupReps}
                    </span>
                  </div>
                )}
                <div className="flex items-center py-3 px-4 bg-bg-surface rounded-lg">
                  <span className="w-8 text-center flex-shrink-0">
                    {i < 3 ? (
                      <span className="text-body-lg">{MEDALS[i]}</span>
                    ) : (
                      <span className="text-body text-ink-muted">{i + 1}.</span>
                    )}
                  </span>
                  <div className="ml-2">
                    <Avatar url={entry.avatarUrl} name={entry.name} />
                  </div>
                  <span className="ml-3 text-body text-ink-primary truncate flex-1">
                    {entry.name}
                  </span>
                  <span className="text-body text-accent font-bold tabular-nums ml-2">
                    {entry.count}
                  </span>
                </div>
              </div>
            );
          })}

          {guestPosition === -1 && signupFlow && !profile && signupReps > 0 && (
            <div className="flex items-center py-3 px-4 bg-bg-surface rounded-lg border-l-4 border-accent shadow-[0_0_16px_2px_rgba(255,155,47,0.15)]">
              <span className="w-8 text-center flex-shrink-0">
                <span className="text-micro text-accent font-bold">You</span>
              </span>
              <div className="ml-2">
                <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
              </div>
              <span className="ml-3 text-body text-accent truncate flex-1 font-semibold">
                Your reps
              </span>
              <span className="text-body text-accent font-bold tabular-nums ml-2">
                {signupReps}
              </span>
            </div>
          )}

          {userEntry && (
            <div className="pt-2 mt-2">
              <p className="text-micro text-ink-secondary uppercase px-2 mb-1">
                YOU
              </p>
              <div className="flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-t-2 border-accent">
                <span className="w-8 text-center flex-shrink-0 text-body text-ink-muted">
                  {userEntry.rank}.
                </span>
                <div className="ml-2">
                  <Avatar
                    url={userEntry.entry.avatarUrl}
                    name={userEntry.entry.name}
                  />
                </div>
                <span className="ml-3 text-body text-ink-primary truncate flex-1">
                  {userEntry.entry.name}
                </span>
                <span className="text-body text-accent font-bold tabular-nums ml-2">
                  {userEntry.entry.count}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : boardType === "session" ? (
        <div className="flex flex-col gap-2">
          {sessionEntries.map((entry, i) => (
            <div key={entry.userId} className="flex items-center py-3 px-4 bg-bg-surface rounded-lg">
              <span className="w-8 text-center flex-shrink-0">
                {i < 3 ? (
                  <span className="text-body-lg">{MEDALS[i]}</span>
                ) : (
                  <span className="text-body text-ink-muted">{i + 1}.</span>
                )}
              </span>
              <div className="ml-2">
                <Avatar url={entry.avatarUrl} name={entry.name} />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate block">
                  {entry.name}
                </span>
                {entry.durationSeconds > 0 && (
                  <span className="text-micro text-ink-muted">
                    {formatSessionDuration(entry.durationSeconds)} · {(entry.repCount / (entry.durationSeconds / 60)).toFixed(1)}/min
                  </span>
                )}
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {entry.repCount}
                </span>
                <span className="text-micro text-ink-muted block">reps</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {streakEntries.map((entry, i) => (
            <div key={entry.userId} className="flex items-center py-3 px-4 bg-bg-surface rounded-lg">
              <span className="w-8 text-center flex-shrink-0">
                {i < 3 ? (
                  <span className="text-body-lg">{MEDALS[i]}</span>
                ) : (
                  <span className="text-body text-ink-muted">{i + 1}.</span>
                )}
              </span>
              <div className="ml-2">
                <Avatar url={entry.avatarUrl} name={entry.name} />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate block">
                  {entry.name}
                </span>
                {entry.currentStreak > 0 && (
                  <span className="text-micro text-accent">
                    {entry.currentStreak}d active
                  </span>
                )}
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {entry.longestStreak}
                </span>
                <span className="text-micro text-ink-muted block">
                  {entry.longestStreak === 1 ? "day" : "days"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!profile && !signupFlow && (
        <div className="mt-8 text-center">
          <button
            onClick={signInWithGoogle}
            className="bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(var(--color-accent-glow-secondary),0.4)]"
          >
            Get on the leaderboard
          </button>
        </div>
      )}
      </div>

      {showSignup && (
        <SignupOverlay
          reps={signupReps}
          onDismiss={() => {
            setShowSignup(false);
            setSearchParams({}, { replace: true });
          }}
        />
      )}
    </div>
  );
}
