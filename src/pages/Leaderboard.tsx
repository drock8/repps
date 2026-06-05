import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber, MEDALS } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { getMascot } from "../lib/mascots";
import { useRepsChannel } from "../hooks/useRepsChannel";
import Avatar from "../components/Avatar";
import OGBadge from "../components/OGBadge";
import { useOG100 } from "../hooks/useOG100";

type GenderFilter = "all" | "female" | "male" | "non_binary";
type TimePeriod = "daily" | "weekly" | "monthly" | "yearly" | "all";
type BoardType = "total" | "session" | "streak" | "rep_score" | "team_score";

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

interface RepScoreEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  score: number;
  baseReps: number;
  individualStreak: number;
  teamStreak: number;
  dailyMultiplierPts: number;
  streakBonusPts: number;
  teamStreakBonusPts: number;
  weeklyMultiplierPts: number;
  dailyMultiplier: number;
  hasActiveTeam: boolean;
}

interface TeamScoreEntry {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  combinedScore: number;
  combinedReps: number;
  members: { user_id: string; name: string; avatar_url: string | null; score: number; base_reps: number }[];
}

interface LatestRepEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  validatedAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const BOARD_TABS: { label: string; value: BoardType }[] = [
  { label: "Teams", value: "team_score" },
  { label: "Score", value: "rep_score" },
  { label: "Repps", value: "total" },
  { label: "Streak", value: "streak" },
  { label: "Session", value: "session" },
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

export default function Leaderboard() {
  const { profile } = useAuth();
  const theme = useTheme();
  const navigate = useNavigate();
  const ogIds = useOG100();
  const [boardType, setBoardType] = useState<BoardType>("total");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
  const [streakEntries, setStreakEntries] = useState<StreakEntry[]>([]);
  const [repScoreEntries, setRepScoreEntries] = useState<RepScoreEntry[]>([]);
  const [teamScoreEntries, setTeamScoreEntries] = useState<TeamScoreEntry[]>([]);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [latestReps, setLatestReps] = useState<LatestRepEntry[]>([]);
  const [showLatest, setShowLatest] = useState(false);
  const [hasRecentActivity, setHasRecentActivity] = useState(false);
  const [totalReps, setTotalReps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userEntry, setUserEntry] = useState<{
    rank: number;
    entry: LeaderboardEntry;
  } | null>(null);
  const [userSessionEntry, setUserSessionEntry] = useState<{ rank: number; entry: SessionEntry } | null>(null);
  const [userStreakEntry, setUserStreakEntry] = useState<{ rank: number; entry: StreakEntry } | null>(null);
  const [userRepScoreEntry, setUserRepScoreEntry] = useState<{ rank: number; entry: RepScoreEntry } | null>(null);
  const [userTeamEntry, setUserTeamEntry] = useState<{ rank: number; entry: TeamScoreEntry } | null>(null);
  const [userRowVisible, setUserRowVisible] = useState(true);
  const userRowRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLatestReps = useCallback(async () => {
    const { data } = await supabase
      .from("reps")
      .select("user_id, validated_at, profiles(name, avatar_url)")
      .order("validated_at", { ascending: false })
      .limit(50);
    if (!data) return;
    const grouped = new Map<string, { name: string; avatarUrl: string | null; count: number; validatedAt: string }>();
    for (const r of data as unknown as { user_id: string; validated_at: string; profiles: { name: string; avatar_url: string | null } }[]) {
      const existing = grouped.get(r.user_id);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(r.user_id, {
          name: r.profiles.name,
          avatarUrl: r.profiles.avatar_url,
          count: 1,
          validatedAt: r.validated_at,
        });
      }
    }
    const results = Array.from(grouped.entries()).map(([userId, v]) => ({
      userId,
      ...v,
    }));
    setLatestReps(results);
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    setHasRecentActivity(results.some(r => new Date(r.validatedAt).getTime() > fiveMinAgo));
  }, []);

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
            const [{ data: rankData }, { data: statsData }] = await Promise.all([
              supabase.rpc("get_user_rank", {
                p_user_id: profile.id,
                p_gender: g === "all" ? null : g,
                p_period: p,
              }),
              supabase.rpc("get_user_stats_summary", { p_user_id: profile.id }),
            ]);
            const row = Array.isArray(rankData) ? rankData[0] : rankData;
            const statsRow = Array.isArray(statsData) ? statsData[0] : statsData;
            const rank = row?.rank ? Number(row.rank) : top50.length + 1;
            setUserEntry({
              rank,
              entry: {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                count: Number(statsRow?.total_reps || 0),
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
        setUserSessionEntry(null);
        setLoading(false);
        return;
      }
      const mapped = (data || []).map((row: { user_id: string; name: string; avatar_url: string | null; rep_count: number; duration_seconds: number }) => ({
        userId: row.user_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        repCount: Number(row.rep_count),
        durationSeconds: Number(row.duration_seconds),
      }));
      setSessionEntries(mapped);

      if (profile) {
        const userMatchesFilter = g === "all" || profile.gender === g;
        const userInList = mapped.some((e: SessionEntry) => e.userId === profile.id);
        if (userMatchesFilter && !userInList) {
          const { data: stats } = await supabase.rpc("get_user_stats_summary", { p_user_id: profile.id });
          const row = Array.isArray(stats) ? stats[0] : stats;
          if (row && Number(row.best_session_count) > 0) {
            setUserSessionEntry({
              rank: mapped.length + 1,
              entry: {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                repCount: Number(row.best_session_count),
                durationSeconds: Number(row.best_session_duration),
              },
            });
          } else {
            setUserSessionEntry(null);
          }
        } else {
          setUserSessionEntry(null);
        }
      } else {
        setUserSessionEntry(null);
      }
      setLoading(false);
    },
    [profile]
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
        setUserStreakEntry(null);
        setLoading(false);
        return;
      }
      const mapped = (data || []).map((row: { out_user_id: string; out_name: string; out_avatar_url: string | null; out_longest_streak: number; out_current_streak: number }) => ({
        userId: row.out_user_id,
        name: row.out_name,
        avatarUrl: row.out_avatar_url,
        longestStreak: Number(row.out_longest_streak),
        currentStreak: Number(row.out_current_streak),
      }));
      setStreakEntries(mapped);

      if (profile) {
        const userMatchesFilter = g === "all" || profile.gender === g;
        const userInList = mapped.some((e: StreakEntry) => e.userId === profile.id);
        if (userMatchesFilter && !userInList) {
          const { data: stats } = await supabase.rpc("get_user_stats_summary", { p_user_id: profile.id });
          const row = Array.isArray(stats) ? stats[0] : stats;
          if (row && (Number(row.longest_streak) > 0 || Number(row.current_streak) > 0)) {
            setUserStreakEntry({
              rank: mapped.length + 1,
              entry: {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                longestStreak: Number(row.longest_streak),
                currentStreak: Number(row.current_streak),
              },
            });
          } else {
            setUserStreakEntry(null);
          }
        } else {
          setUserStreakEntry(null);
        }
      } else {
        setUserStreakEntry(null);
      }
      setLoading(false);
    },
    [profile]
  );

  const fetchRepScoreLeaderboard = useCallback(
    async (g: GenderFilter, p: TimePeriod) => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_rep_score_leaderboard", {
        p_gender: g === "all" ? null : g,
        p_period: p,
        p_limit: 50,
      });
      if (error) {
        console.error("Rep score leaderboard error:", error);
        setRepScoreEntries([]);
        setUserRepScoreEntry(null);
        setLoading(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (data || []).map((row: any) => ({
        userId: row.user_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        score: Number(row.score),
        baseReps: Number(row.base_reps),
        individualStreak: Number(row.individual_streak),
        teamStreak: Number(row.team_streak),
        dailyMultiplierPts: Number(row.daily_multiplier_pts || 0),
        streakBonusPts: Number(row.streak_bonus_pts || 0),
        teamStreakBonusPts: Number(row.team_streak_bonus_pts || 0),
        weeklyMultiplierPts: Number(row.weekly_multiplier_pts || 0),
        dailyMultiplier: Number(row.daily_multiplier || 1),
        hasActiveTeam: Boolean(row.has_active_team),
      }));
      setRepScoreEntries(mapped);

      if (profile) {
        const userMatchesFilter = g === "all" || profile.gender === g;
        const userInList = mapped.some((e: RepScoreEntry) => e.userId === profile.id);
        if (userMatchesFilter && !userInList) {
          const { data: scoreData } = await supabase.rpc("calculate_user_rep_score", {
            p_user_id: profile.id,
            p_period: p,
          });
          const row = Array.isArray(scoreData) ? scoreData[0] : scoreData;
          if (row && Number(row.score) > 0) {
            setUserRepScoreEntry({
              rank: mapped.length + 1,
              entry: {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                score: Number(row.score),
                baseReps: Number(row.base_reps || 0),
                individualStreak: Number(row.individual_streak || 0),
                teamStreak: Number(row.team_streak || 0),
                dailyMultiplierPts: Number(row.daily_multiplier_pts || 0),
                streakBonusPts: Number(row.streak_bonus_pts || 0),
                teamStreakBonusPts: Number(row.team_streak_bonus_pts || 0),
                weeklyMultiplierPts: Number(row.weekly_multiplier_pts || 0),
                dailyMultiplier: Number(row.daily_multiplier || 1),
                hasActiveTeam: Boolean(row.has_active_team),
              },
            });
          } else {
            setUserRepScoreEntry(null);
          }
        } else {
          setUserRepScoreEntry(null);
        }
      } else {
        setUserRepScoreEntry(null);
      }
      setLoading(false);
    },
    [profile]
  );

  const fetchTeamScoreLeaderboard = useCallback(
    async (p: TimePeriod) => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_team_score_leaderboard", {
        p_period: p,
        p_limit: 50,
      });
      if (error) {
        console.error("Team score leaderboard error:", error);
        setTeamScoreEntries([]);
        setUserTeamEntry(null);
        setLoading(false);
        return;
      }
      const mapped = (data || []).map((row: { team_id: string; team_name: string; team_logo_url: string | null; combined_score: number; combined_reps: number; member_scores: { user_id: string; name: string; avatar_url: string | null; score: number; base_reps: number }[] }) => ({
        teamId: row.team_id,
        teamName: row.team_name,
        teamLogoUrl: row.team_logo_url || null,
        combinedScore: Number(row.combined_score),
        combinedReps: Number(row.combined_reps || 0),
        members: (row.member_scores || []).map((m: { user_id: string; name: string; avatar_url: string | null; score: number; base_reps?: number }) => ({
          ...m,
          base_reps: Number(m.base_reps || 0),
        })),
      }));
      setTeamScoreEntries(mapped);

      if (profile?.team_id) {
        const teamInList = mapped.some((e: TeamScoreEntry) => e.teamId === profile.team_id);
        if (!teamInList) {
          const { data: teamData } = await supabase
            .from("teams")
            .select("id, name, logo_url")
            .eq("id", profile.team_id)
            .single();
          if (teamData) {
            const { data: members } = await supabase
              .from("profiles")
              .select("id, name, avatar_url")
              .eq("team_id", profile.team_id);
            let combinedScore = 0;
            let combinedReps = 0;
            const memberScores: TeamScoreEntry["members"] = [];
            for (const m of members || []) {
              const { data: scoreData } = await supabase.rpc("calculate_user_rep_score", {
                p_user_id: m.id,
                p_period: p,
              });
              const s = Array.isArray(scoreData) ? scoreData[0] : scoreData;
              const score = Number(s?.score || 0);
              const baseReps = Number(s?.base_reps || 0);
              combinedScore += score;
              combinedReps += baseReps;
              memberScores.push({ user_id: m.id, name: m.name, avatar_url: m.avatar_url, score, base_reps: baseReps });
            }
            if (combinedScore > 0) {
              setUserTeamEntry({
                rank: mapped.length + 1,
                entry: {
                  teamId: teamData.id,
                  teamName: teamData.name,
                  teamLogoUrl: teamData.logo_url || null,
                  combinedScore,
                  combinedReps,
                  members: memberScores,
                },
              });
            } else {
              setUserTeamEntry(null);
            }
          } else {
            setUserTeamEntry(null);
          }
        } else {
          setUserTeamEntry(null);
        }
      } else {
        setUserTeamEntry(null);
      }
      setLoading(false);
    },
    [profile]
  );

  useEffect(() => {
    fetchTotalReps();
    fetchLatestReps();
    if (boardType === "total") {
      fetchLeaderboard(gender, period);
    } else if (boardType === "session") {
      fetchSessionLeaderboard(gender);
    } else if (boardType === "streak") {
      fetchStreakLeaderboard(gender);
    } else if (boardType === "rep_score") {
      fetchRepScoreLeaderboard(gender, period);
    } else if (boardType === "team_score") {
      fetchTeamScoreLeaderboard(period);
    }
  }, [gender, period, boardType, fetchLeaderboard, fetchSessionLeaderboard, fetchStreakLeaderboard, fetchRepScoreLeaderboard, fetchTeamScoreLeaderboard, fetchTotalReps, fetchLatestReps]);

  useRepsChannel(
    useCallback(() => {
      setTotalReps((prev) => prev + 1);
      setHasRecentActivity(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchLatestReps();
        if (boardType === "total") fetchLeaderboard(gender, period);
        else if (boardType === "session") fetchSessionLeaderboard(gender);
        else if (boardType === "streak") fetchStreakLeaderboard(gender);
        else if (boardType === "rep_score") fetchRepScoreLeaderboard(gender, period);
        else if (boardType === "team_score") fetchTeamScoreLeaderboard(period);
      }, 2000);
    }, [gender, period, boardType, fetchLeaderboard, fetchSessionLeaderboard, fetchStreakLeaderboard, fetchRepScoreLeaderboard, fetchTeamScoreLeaderboard, fetchLatestReps])
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    const el = userRowRef.current;
    const root = scrollContainerRef.current;
    if (!el || !root) {
      setUserRowVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setUserRowVisible(entry.isIntersecting),
      { root, threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [boardType, gender, period, loading, entries, sessionEntries, streakEntries, repScoreEntries, teamScoreEntries, userEntry, userSessionEntry, userStreakEntry, userRepScoreEntry, userTeamEntry]);

  const scrollToUserRow = () => {
    userRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
        ? sessionEntries.length === 0 && !userSessionEntry
        : boardType === "streak"
          ? streakEntries.length === 0 && !userStreakEntry
          : boardType === "rep_score"
            ? repScoreEntries.length === 0 && !userRepScoreEntry
            : teamScoreEntries.length === 0 && !userTeamEntry;

  // Determine the user's pinned card data — either from explicit userEntry (not in top 50)
  // or derived from their position in the list (in top 50 but scrolled out of view)
  const pinnedTotal = (() => {
    if (userEntry) return userEntry;
    if (!profile || boardType !== "total") return null;
    const idx = entries.findIndex(e => e.userId === profile.id);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: entries[idx] };
  })();

  const pinnedSession = (() => {
    if (userSessionEntry) return userSessionEntry;
    if (!profile || boardType !== "session") return null;
    const idx = sessionEntries.findIndex(e => e.userId === profile.id);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: sessionEntries[idx] };
  })();

  const pinnedStreak = (() => {
    if (userStreakEntry) return userStreakEntry;
    if (!profile || boardType !== "streak") return null;
    const idx = streakEntries.findIndex(e => e.userId === profile.id);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: streakEntries[idx] };
  })();

  const pinnedRepScore = (() => {
    if (userRepScoreEntry) return userRepScoreEntry;
    if (!profile || boardType !== "rep_score") return null;
    const idx = repScoreEntries.findIndex(e => e.userId === profile.id);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: repScoreEntries[idx] };
  })();

  const pinnedTeam = (() => {
    if (userTeamEntry) return userTeamEntry;
    if (!profile?.team_id || boardType !== "team_score") return null;
    const idx = teamScoreEntries.findIndex(e => e.teamId === profile.team_id);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: teamScoreEntries[idx] };
  })();

  const showPinnedCard = !userRowVisible && !loading && (
    !!pinnedTotal || !!pinnedSession || !!pinnedStreak || !!pinnedRepScore || !!pinnedTeam
  );

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.24)-theme(spacing.12))]">
      <div className="flex-shrink-0 bg-bg-base">
        <div className="relative flex flex-col items-center mt-2 mb-4">
          <img
            src={getMascot(theme, "pumped")}
            alt=""
            className="absolute w-[4.5rem] left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <button
            onClick={() => { setShowLatest(!showLatest); setHasRecentActivity(false); }}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center"
          >
            <div className="relative">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-secondary">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              {hasRecentActivity && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
              )}
            </div>
          </button>
          <p className="text-headline text-ink-primary">GBT</p>
          <p className="text-display-lg repps-gradient-text mt-1 tabular-nums">
            {formatNumber(totalReps)}
          </p>
          <p className="text-micro text-ink-secondary uppercase tracking-wide mt-1">
            Global Burpee Total
          </p>
        </div>

        {/* Latest activity panel */}
        {showLatest && latestReps.length > 0 && (
          <div className="mb-3 bg-bg-surface rounded-lg p-3 animate-[fadeIn_200ms_ease-out]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-micro text-ink-muted uppercase tracking-wide">Latest Activity</p>
              <button onClick={() => setShowLatest(false)} className="text-ink-muted p-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {latestReps.map((r) => (
                <div key={r.userId} className="flex items-center gap-2.5">
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-caption text-ink-primary truncate block">{r.name}</span>
                  </div>
                  <span className="text-caption text-accent font-bold tabular-nums">{r.count}</span>
                  <span className="text-micro text-ink-muted tabular-nums w-6 text-right">{timeAgo(r.validatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {boardType !== "team_score" && (
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
        )}

        {(boardType === "total" || boardType === "rep_score" || boardType === "team_score") && (
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

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
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
            const isMe = profile && entry.userId === profile.id;
            return (
              <div key={entry.userId} ref={isMe ? userRowRef : undefined}>
                <button
                  onClick={() => {
                    if (isMe) navigate("/profile");
                    else navigate(`/user/${entry.userId}`);
                  }}
                  className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMe ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
                >
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
                  <span className="ml-3 text-body text-ink-primary truncate flex-1 flex items-center gap-1">
                    {entry.name}
                    {ogIds.has(entry.userId) && <OGBadge />}
                  </span>
                  <span className="text-body text-accent font-bold tabular-nums ml-2">
                    {entry.count}
                  </span>
                </button>
              </div>
            );
          })}
          {userEntry && (
            <div ref={userRowRef} className="pt-1 mt-1 border-t border-border-default">
              <button
                onClick={() => navigate("/profile")}
                className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
              >
                <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                  #{userEntry.rank}
                </span>
                <div className="ml-2">
                  <Avatar url={userEntry.entry.avatarUrl} name={userEntry.entry.name} />
                </div>
                <span className="ml-3 text-body text-ink-primary truncate flex-1 flex items-center gap-1">
                  {userEntry.entry.name}
                  {ogIds.has(userEntry.entry.userId) && <OGBadge />}
                </span>
                <span className="text-body text-accent font-bold tabular-nums ml-2">
                  {userEntry.entry.count}
                </span>
              </button>
            </div>
          )}
        </div>
      ) : boardType === "session" ? (
        <div className="flex flex-col gap-2">
          {sessionEntries.map((entry, i) => {
            const isMe = profile && entry.userId === profile.id;
            return (
            <div key={entry.userId} ref={isMe ? userRowRef : undefined}>
            <button
              onClick={() => {
                if (isMe) navigate("/profile");
                else navigate(`/user/${entry.userId}`);
              }}
              className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMe ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
            >
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
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {entry.name}
                  {ogIds.has(entry.userId) && <OGBadge />}
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
                <span className="text-micro text-ink-muted block">repps</span>
              </div>
            </button>
            </div>
            );
          })}
          {userSessionEntry && (
            <div ref={userRowRef} className="pt-1 mt-1 border-t border-border-default">
              <button
                onClick={() => navigate("/profile")}
                className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
              >
                <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                  #{userSessionEntry.rank}
                </span>
                <div className="ml-2">
                  <Avatar url={userSessionEntry.entry.avatarUrl} name={userSessionEntry.entry.name} />
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate flex items-center gap-1">
                    {userSessionEntry.entry.name}
                    {ogIds.has(userSessionEntry.entry.userId) && <OGBadge />}
                  </span>
                  {userSessionEntry.entry.durationSeconds > 0 && (
                    <span className="text-micro text-ink-muted">
                      {formatSessionDuration(userSessionEntry.entry.durationSeconds)} · {(userSessionEntry.entry.repCount / (userSessionEntry.entry.durationSeconds / 60)).toFixed(1)}/min
                    </span>
                  )}
                </div>
                <div className="text-right ml-2">
                  <span className="text-body text-accent font-bold tabular-nums">
                    {userSessionEntry.entry.repCount}
                  </span>
                  <span className="text-micro text-ink-muted block">repps</span>
                </div>
              </button>
            </div>
          )}
        </div>
      ) : boardType === "streak" ? (
        <div className="flex flex-col gap-2">
          {streakEntries.map((entry, i) => {
            const isMe = profile && entry.userId === profile.id;
            return (
            <div key={entry.userId} ref={isMe ? userRowRef : undefined}>
            <button
              onClick={() => {
                if (isMe) navigate("/profile");
                else navigate(`/user/${entry.userId}`);
              }}
              className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMe ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
            >
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
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {entry.name}
                  {ogIds.has(entry.userId) && <OGBadge />}
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
            </button>
            </div>
            );
          })}
          {userStreakEntry && (
            <div ref={userRowRef} className="pt-1 mt-1 border-t border-border-default">
              <button
                onClick={() => navigate("/profile")}
                className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
              >
                <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                  #{userStreakEntry.rank}
                </span>
                <div className="ml-2">
                  <Avatar url={userStreakEntry.entry.avatarUrl} name={userStreakEntry.entry.name} />
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate flex items-center gap-1">
                    {userStreakEntry.entry.name}
                    {ogIds.has(userStreakEntry.entry.userId) && <OGBadge />}
                  </span>
                  {userStreakEntry.entry.currentStreak > 0 && (
                    <span className="text-micro text-accent">
                      {userStreakEntry.entry.currentStreak}d active
                    </span>
                  )}
                </div>
                <div className="text-right ml-2">
                  <span className="text-body text-accent font-bold tabular-nums">
                    {userStreakEntry.entry.longestStreak}
                  </span>
                  <span className="text-micro text-ink-muted block">
                    {userStreakEntry.entry.longestStreak === 1 ? "day" : "days"}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      ) : boardType === "rep_score" ? (
        <div className="flex flex-col gap-2">
          {repScoreEntries.map((entry, i) => {
            const isMe = profile && entry.userId === profile.id;
            return (
            <div key={entry.userId} ref={isMe ? userRowRef : undefined}>
            <button
              onClick={() => {
                if (isMe) navigate("/profile");
                else navigate(`/user/${entry.userId}`);
              }}
              className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMe ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
            >
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
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {entry.name}
                  {ogIds.has(entry.userId) && <OGBadge />}
                </span>
                <div className="flex flex-wrap gap-x-2 gap-y-0">
                  <span className="text-micro text-ink-muted">{formatNumber(entry.baseReps)} base</span>
                  {entry.dailyMultiplierPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(entry.dailyMultiplierPts)} {entry.dailyMultiplier}x</span>
                  )}
                  {entry.streakBonusPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(entry.streakBonusPts)} streak</span>
                  )}
                  {entry.teamStreakBonusPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(entry.teamStreakBonusPts)} team</span>
                  )}
                  {entry.weeklyMultiplierPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(entry.weeklyMultiplierPts)} weekly</span>
                  )}
                </div>
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {formatNumber(entry.score)}
                </span>
                <span className="text-micro text-ink-muted block">pts</span>
              </div>
            </button>
            </div>
            );
          })}
          {userRepScoreEntry && (
            <div ref={userRowRef} className="pt-1 mt-1 border-t border-border-default">
              <button
                onClick={() => navigate("/profile")}
                className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
              >
                <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                  #{userRepScoreEntry.rank}
                </span>
                <div className="ml-2">
                  <Avatar url={userRepScoreEntry.entry.avatarUrl} name={userRepScoreEntry.entry.name} />
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate flex items-center gap-1">
                    {userRepScoreEntry.entry.name}
                    {ogIds.has(userRepScoreEntry.entry.userId) && <OGBadge />}
                  </span>
                  <div className="flex flex-wrap gap-x-2 gap-y-0">
                    <span className="text-micro text-ink-muted">{formatNumber(userRepScoreEntry.entry.baseReps)} base</span>
                    {userRepScoreEntry.entry.dailyMultiplierPts > 0 && (
                      <span className="text-micro text-accent">+{formatNumber(userRepScoreEntry.entry.dailyMultiplierPts)} {userRepScoreEntry.entry.dailyMultiplier}x</span>
                    )}
                    {userRepScoreEntry.entry.streakBonusPts > 0 && (
                      <span className="text-micro text-accent">+{formatNumber(userRepScoreEntry.entry.streakBonusPts)} streak</span>
                    )}
                  </div>
                </div>
                <div className="text-right ml-2">
                  <span className="text-body text-accent font-bold tabular-nums">
                    {formatNumber(userRepScoreEntry.entry.score)}
                  </span>
                  <span className="text-micro text-ink-muted block">pts</span>
                </div>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {teamScoreEntries.map((entry, i) => {
            const isMyTeam = profile?.team_id && entry.teamId === profile.team_id;
            return (
            <div key={entry.teamId} ref={isMyTeam ? userRowRef : undefined}>
              <button
                onClick={() => setExpandedTeamId(expandedTeamId === entry.teamId ? null : entry.teamId)}
                className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMyTeam ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
              >
                <span className="w-8 text-center flex-shrink-0">
                  {i < 3 ? (
                    <span className="text-body-lg">{MEDALS[i]}</span>
                  ) : (
                    <span className="text-body text-ink-muted">{i + 1}.</span>
                  )}
                </span>
                {entry.teamLogoUrl ? (
                  <img
                    src={entry.teamLogoUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="ml-2 w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="ml-2 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                  </div>
                )}
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate block">
                    {entry.teamName}
                  </span>
                  <span className="text-micro text-ink-muted">
                    {entry.members.length} members
                  </span>
                </div>
                <div className="text-right ml-2 flex items-center gap-2">
                  <div className="text-right">
                    <span className="text-caption text-ink-secondary tabular-nums">
                      {formatNumber(entry.combinedReps)}
                    </span>
                    <span className="text-micro text-ink-muted block">repps</span>
                  </div>
                  <div className="text-right">
                    <span className="text-body text-accent font-bold tabular-nums">
                      {formatNumber(entry.combinedScore)}
                    </span>
                    <span className="text-micro text-ink-muted block">pts</span>
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-ink-muted transition-transform duration-200 ${expandedTeamId === entry.teamId ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
              </button>
              {expandedTeamId === entry.teamId && (
                <div className="ml-10 mt-1 flex flex-col gap-1">
                  {[...entry.members]
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((m) => (
                    <button
                      key={m.user_id}
                      onClick={() => {
                        if (profile && m.user_id === profile.id) navigate("/profile");
                        else navigate(`/user/${m.user_id}`);
                      }}
                      className="w-full flex items-center py-2 px-3 bg-bg-elevated rounded-md text-left"
                    >
                      <Avatar url={m.avatar_url} name={m.name} />
                      <span className="ml-2 text-caption text-ink-primary truncate flex-1 flex items-center gap-1">
                        {m.name}
                        {ogIds.has(m.user_id) && <OGBadge size={14} />}
                      </span>
                      <span className="text-micro text-ink-secondary tabular-nums ml-2">
                        {formatNumber(m.base_reps)}
                      </span>
                      <span className="text-caption text-accent font-bold tabular-nums ml-2">
                        {formatNumber(m.score)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            );
          })}
          {userTeamEntry && (
            <div ref={userRowRef} className="pt-1 mt-1 border-t border-border-default">
              <button
                onClick={() => navigate("/team")}
                className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
              >
                <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                  #{userTeamEntry.rank}
                </span>
                {userTeamEntry.entry.teamLogoUrl ? (
                  <img src={userTeamEntry.entry.teamLogoUrl} alt="" referrerPolicy="no-referrer" className="ml-2 w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="ml-2 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                  </div>
                )}
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate block">{userTeamEntry.entry.teamName}</span>
                  <span className="text-micro text-ink-muted">{userTeamEntry.entry.members.length} members</span>
                </div>
                <div className="text-right ml-2 flex items-center gap-2">
                  <div className="text-right">
                    <span className="text-caption text-ink-secondary tabular-nums">{formatNumber(userTeamEntry.entry.combinedReps)}</span>
                    <span className="text-micro text-ink-muted block">repps</span>
                  </div>
                  <div className="text-right">
                    <span className="text-body text-accent font-bold tabular-nums">{formatNumber(userTeamEntry.entry.combinedScore)}</span>
                    <span className="text-micro text-ink-muted block">pts</span>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      </div>

      {/* Pinned "YOU" card — visible only when user's row is scrolled out of view. Tap to scroll to their position. */}
      {showPinnedCard && (
        <div className="flex-shrink-0 pt-2 pb-1 bg-bg-base border-t border-border-default">
          {pinnedTotal && (
            <button
              onClick={scrollToUserRow}
              className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
            >
              <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                #{pinnedTotal.rank}
              </span>
              <div className="ml-2">
                <Avatar url={pinnedTotal.entry.avatarUrl} name={pinnedTotal.entry.name} />
              </div>
              <span className="ml-3 text-body text-ink-primary truncate flex-1 flex items-center gap-1">
                {pinnedTotal.entry.name}
                {ogIds.has(pinnedTotal.entry.userId) && <OGBadge />}
              </span>
              <span className="text-body text-accent font-bold tabular-nums ml-2">
                {pinnedTotal.entry.count}
              </span>
            </button>
          )}

          {pinnedSession && (
            <button
              onClick={scrollToUserRow}
              className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
            >
              <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                #{pinnedSession.rank}
              </span>
              <div className="ml-2">
                <Avatar url={pinnedSession.entry.avatarUrl} name={pinnedSession.entry.name} />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {pinnedSession.entry.name}
                  {ogIds.has(pinnedSession.entry.userId) && <OGBadge />}
                </span>
                {pinnedSession.entry.durationSeconds > 0 && (
                  <span className="text-micro text-ink-muted">
                    {formatSessionDuration(pinnedSession.entry.durationSeconds)} · {(pinnedSession.entry.repCount / (pinnedSession.entry.durationSeconds / 60)).toFixed(1)}/min
                  </span>
                )}
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {pinnedSession.entry.repCount}
                </span>
                <span className="text-micro text-ink-muted block">repps</span>
              </div>
            </button>
          )}

          {pinnedStreak && (
            <button
              onClick={scrollToUserRow}
              className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
            >
              <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                #{pinnedStreak.rank}
              </span>
              <div className="ml-2">
                <Avatar url={pinnedStreak.entry.avatarUrl} name={pinnedStreak.entry.name} />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {pinnedStreak.entry.name}
                  {ogIds.has(pinnedStreak.entry.userId) && <OGBadge />}
                </span>
                {pinnedStreak.entry.currentStreak > 0 && (
                  <span className="text-micro text-accent">
                    {pinnedStreak.entry.currentStreak}d active
                  </span>
                )}
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {pinnedStreak.entry.longestStreak}
                </span>
                <span className="text-micro text-ink-muted block">
                  {pinnedStreak.entry.longestStreak === 1 ? "day" : "days"}
                </span>
              </div>
            </button>
          )}

          {pinnedRepScore && (
            <button
              onClick={scrollToUserRow}
              className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
            >
              <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                #{pinnedRepScore.rank}
              </span>
              <div className="ml-2">
                <Avatar url={pinnedRepScore.entry.avatarUrl} name={pinnedRepScore.entry.name} />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate flex items-center gap-1">
                  {pinnedRepScore.entry.name}
                  {ogIds.has(pinnedRepScore.entry.userId) && <OGBadge />}
                </span>
                <div className="flex flex-wrap gap-x-2 gap-y-0">
                  <span className="text-micro text-ink-muted">{formatNumber(pinnedRepScore.entry.baseReps)} base</span>
                  {pinnedRepScore.entry.dailyMultiplierPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(pinnedRepScore.entry.dailyMultiplierPts)} {pinnedRepScore.entry.dailyMultiplier}x</span>
                  )}
                  {pinnedRepScore.entry.streakBonusPts > 0 && (
                    <span className="text-micro text-accent">+{formatNumber(pinnedRepScore.entry.streakBonusPts)} streak</span>
                  )}
                </div>
              </div>
              <div className="text-right ml-2">
                <span className="text-body text-accent font-bold tabular-nums">
                  {formatNumber(pinnedRepScore.entry.score)}
                </span>
                <span className="text-micro text-ink-muted block">pts</span>
              </div>
            </button>
          )}

          {pinnedTeam && (
            <button
              onClick={scrollToUserRow}
              className="w-full flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-l-2 border-accent text-left"
            >
              <span className="w-8 text-center flex-shrink-0 text-body text-accent font-bold">
                #{pinnedTeam.rank}
              </span>
              {pinnedTeam.entry.teamLogoUrl ? (
                <img src={pinnedTeam.entry.teamLogoUrl} alt="" referrerPolicy="no-referrer" className="ml-2 w-8 h-8 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="ml-2 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
              )}
              <div className="ml-3 flex-1 min-w-0">
                <span className="text-body text-ink-primary truncate block">{pinnedTeam.entry.teamName}</span>
                <span className="text-micro text-ink-muted">{pinnedTeam.entry.members.length} members</span>
              </div>
              <div className="text-right ml-2 flex items-center gap-2">
                <div className="text-right">
                  <span className="text-caption text-ink-secondary tabular-nums">{formatNumber(pinnedTeam.entry.combinedReps)}</span>
                  <span className="text-micro text-ink-muted block">repps</span>
                </div>
                <div className="text-right">
                  <span className="text-body text-accent font-bold tabular-nums">{formatNumber(pinnedTeam.entry.combinedScore)}</span>
                  <span className="text-micro text-ink-muted block">pts</span>
                </div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
