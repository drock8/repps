import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber, MEDALS } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { getMascot } from "../lib/mascots";
import { useRepsChannel } from "../hooks/useRepsChannel";
import Avatar from "../components/Avatar";
import OGBadge from "../components/OGBadge";
import { useOG100 } from "../hooks/useOG100";
import FilterSheet from "../components/leaderboard/FilterSheet";
import type { FilterState } from "../components/leaderboard/FilterSheet";
import PunchcardChart from "../components/leaderboard/PunchcardChart";
import { flagEmoji } from "../lib/flagEmoji";
import { COUNTRIES } from "../data/countries";

// ── Types ──────────────────────────────────────────────────────

type Scope = "individual" | "team" | "country";
type Metric = "reps" | "consistency" | "score" | "streak" | "session";
type TimePeriod = "daily" | "weekly" | "monthly" | "yearly" | "all";
type GenderFilter = "all" | "female" | "male" | "non_binary";

interface IndividualEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  metric: Metric;
  primaryValue: number;
  secondaryLabel: string;
  // Score breakdown (when metric=score)
  baseReps?: number;
  dailyMultiplierPts?: number;
  dailyMultiplier?: number;
  streakBonusPts?: number;
  teamStreakBonusPts?: number;
  weeklyMultiplierPts?: number;
  // Session (when metric=session)
  durationSeconds?: number;
  // Streak (when metric=streak)
  currentStreak?: number;
}

interface TeamEntry {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  metric: Metric;
  primaryValue: number;
  secondaryLabel: string;
  members: { user_id: string; name: string; avatar_url: string | null; value: number; secondary?: number }[];
  // Session extra
  bestMemberName?: string;
  durationSeconds?: number;
  // Streak extra
  currentStreak?: number;
}

interface CountryEntry {
  countryCode: string;
  countryName: string;
  metric: Metric;
  primaryValue: number;
  secondaryLabel: string;
  memberCount: number;
}

interface ConsistencyEntry {
  entityId: string;
  name: string;
  avatarUrl: string | null;
  consistencyScore: number;
  qualifyingWeeks: number;
  avgWeeklyReps: number;
  totalReps: number;
}

interface HeatmapCell {
  day: number;
  hour: number;
  count: number;
}

const COUNTRY_MAP = new Map(COUNTRIES.map(c => [c.code, c.name]));

interface LatestRepEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  validatedAt: string;
}

// ── Constants ──────────────────────────────────────────────────

const SCOPE_TABS: { label: string; value: Scope }[] = [
  { label: "Individual", value: "individual" },
  { label: "Team", value: "team" },
  { label: "Country", value: "country" },
];

const METRIC_TABS: { label: string; value: Metric }[] = [
  { label: "Repps", value: "reps" },
  { label: "Consistency", value: "consistency" },
  { label: "Score", value: "score" },
  { label: "Streak", value: "streak" },
  { label: "Session", value: "session" },
];

const TIME_LABELS: Record<TimePeriod, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  yearly: "This Year",
  all: "All Time",
};

const URL_TO_PERIOD: Record<string, TimePeriod> = {
  today: "daily", week: "weekly", month: "monthly", year: "yearly", all: "all",
};
const PERIOD_TO_URL: Record<TimePeriod, string> = {
  daily: "today", weekly: "week", monthly: "month", yearly: "year", all: "all",
};

function parseAgeBracket(bracket: string): { min: number | null; max: number | null } {
  if (bracket === "all" || !bracket) return { min: null, max: null };
  if (bracket === "100+") return { min: 100, max: null };
  const [lo, hi] = bracket.split("-").map(Number);
  return { min: lo, max: hi };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatSessionDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ── URL state helpers ──────────────────────────────────────────

function readUrlState(params: URLSearchParams) {
  const validScopes: Scope[] = ["individual", "team", "country"];
  const validMetrics: Metric[] = ["reps", "consistency", "score", "streak", "session"];
  const validGenders: GenderFilter[] = ["all", "female", "male", "non_binary"];

  const scope = validScopes.includes(params.get("scope") as Scope)
    ? (params.get("scope") as Scope)
    : "individual";
  const metric = validMetrics.includes(params.get("metric") as Metric)
    ? (params.get("metric") as Metric)
    : "reps";
  const timeParam = params.get("time") || "today";
  const period = URL_TO_PERIOD[timeParam] || "daily";
  const gender = validGenders.includes(params.get("gender") as GenderFilter)
    ? (params.get("gender") as GenderFilter)
    : "all";
  const age = params.get("age") || "all";
  const country = params.get("country") || "";

  return { scope, metric, period, gender, ageBracket: age, country };
}

function writeUrlState(state: {
  scope: Scope; metric: Metric; period: TimePeriod;
  gender: GenderFilter; ageBracket: string; country: string;
}) {
  const params = new URLSearchParams();
  if (state.scope !== "individual") params.set("scope", state.scope);
  if (state.metric !== "reps") params.set("metric", state.metric);
  if (state.period !== "daily") params.set("time", PERIOD_TO_URL[state.period]);
  if (state.gender !== "all") params.set("gender", state.gender);
  if (state.ageBracket !== "all") params.set("age", state.ageBracket);
  if (state.country) params.set("country", state.country);
  const qs = params.toString();
  const url = qs ? `/leaderboard?${qs}` : "/leaderboard";
  window.history.replaceState(null, "", url);
}

// ── Component ──────────────────────────────────────────────────

export default function Leaderboard() {
  const { profile } = useAuth();
  const theme = useTheme();
  const navigate = useNavigate();
  const ogIds = useOG100();
  const [searchParams] = useSearchParams();

  // Read initial state from URL
  const initial = readUrlState(searchParams);

  const [scope, setScope] = useState<Scope>(initial.scope);
  const [metric, setMetric] = useState<Metric>(initial.metric);
  const [period, setPeriod] = useState<TimePeriod>(initial.period);
  const [gender, setGender] = useState<GenderFilter>(initial.gender);
  const [ageBracket, setAgeBracket] = useState(initial.ageBracket);
  const [countryFilter, setCountryFilter] = useState(initial.country);

  const [individualEntries, setIndividualEntries] = useState<IndividualEntry[]>([]);
  const [teamEntries, setTeamEntries] = useState<TeamEntry[]>([]);
  const [countryEntries, setCountryEntries] = useState<CountryEntry[]>([]);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [latestReps, setLatestReps] = useState<LatestRepEntry[]>([]);
  const [showLatest, setShowLatest] = useState(false);
  const [hasRecentActivity, setHasRecentActivity] = useState(false);
  const [totalReps, setTotalReps] = useState(0);
  const [consistencyEntries, setConsistencyEntries] = useState<ConsistencyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [heatmapTab, setHeatmapTab] = useState<"global" | "mine">("global");
  const [heatmapGlobal, setHeatmapGlobal] = useState<HeatmapCell[]>([]);
  const [heatmapMine, setHeatmapMine] = useState<HeatmapCell[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const heatmapCacheRef = useRef<{ global?: { data: HeatmapCell[]; at: number }; mine?: { data: HeatmapCell[]; at: number } }>({});

  // Pinned card state
  const [userPinned, setUserPinned] = useState<{ rank: number; entry: IndividualEntry } | null>(null);
  const [teamPinned, setTeamPinned] = useState<{ rank: number; entry: TeamEntry } | null>(null);
  const [userRowVisible, setUserRowVisible] = useState(true);
  const userRowRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accentColor = useMemo(() => {
    const el = document.documentElement;
    return getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#FFD600";
  }, []);

  // ── URL sync ────────────────────────────────────────────────
  useEffect(() => {
    writeUrlState({ scope, metric, period, gender, ageBracket, country: countryFilter });
  }, [scope, metric, period, gender, ageBracket, countryFilter]);

  // ── Filter helpers ──────────────────────────────────────────
  const ageParams = parseAgeBracket(ageBracket);

  const filterLine = (() => {
    const parts: string[] = [TIME_LABELS[period]];
    if (gender !== "all") {
      const labels: Record<string, string> = { female: "Female", male: "Male", non_binary: "Non-binary" };
      parts.push(labels[gender]);
    }
    if (ageBracket !== "all") parts.push(ageBracket);
    if (countryFilter && scope === "individual") parts.push(countryFilter);
    return parts;
  })();

  const nonDefaultFilterCount = (gender !== "all" ? 1 : 0)
    + (ageBracket !== "all" ? 1 : 0)
    + (countryFilter && scope === "individual" ? 1 : 0);

  // ── Latest activity ─────────────────────────────────────────
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
      if (existing) existing.count++;
      else grouped.set(r.user_id, { name: r.profiles.name, avatarUrl: r.profiles.avatar_url, count: 1, validatedAt: r.validated_at });
    }
    const results = Array.from(grouped.entries()).map(([userId, v]) => ({ userId, ...v }));
    setLatestReps(results);
    setHasRecentActivity(results.some(r => new Date(r.validatedAt).getTime() > Date.now() - 5 * 60 * 1000));
  }, []);

  const fetchTotalReps = useCallback(async () => {
    const { count } = await supabase.from("reps").select("*", { count: "exact", head: true });
    if (count !== null) setTotalReps(count);
  }, []);

  // ── Pinned card resolution ──────────────────────────────────

  const fetchUserPinnedData = useCallback(async (m: Metric) => {
    if (!profile) return;
    const genderParam = gender === "all" ? null : gender;
    const countryParam = countryFilter || null;

    if (m === "reps") {
      const { data: rankData } = await supabase.rpc("get_user_rank", {
        p_user_id: profile.id, p_gender: genderParam, p_period: period,
        p_age_min: ageParams.min, p_age_max: ageParams.max, p_country: countryParam,
      });
      const row = Array.isArray(rankData) ? rankData[0] : rankData;
      const count = Number(row?.metric_value || 0);
      if (count > 0) {
        setUserPinned({ rank: Number(row?.rank || 51), entry: {
          userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url,
          metric: "reps", primaryValue: count, secondaryLabel: "repps",
        }});
      } else setUserPinned(null);
    } else if (m === "score") {
      const { data } = await supabase.rpc("calculate_user_rep_score", { p_user_id: profile.id, p_period: period });
      const row = Array.isArray(data) ? data[0] : data;
      const score = Number(row?.score || 0);
      if (score > 0) {
        const { data: boardData } = await supabase.rpc("get_rep_score_leaderboard", {
          p_gender: genderParam, p_period: period, p_limit: 200,
          p_age_min: ageParams.min, p_age_max: ageParams.max, p_country: countryParam,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rank = ((boardData || []) as any[]).findIndex((r: any) => r.user_id === profile.id) + 1 || (boardData || []).length + 1;
        setUserPinned({ rank, entry: {
          userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url,
          metric: "score", primaryValue: score, secondaryLabel: "pts",
          baseReps: Number(row.base_reps || 0), dailyMultiplierPts: Number(row.daily_multiplier_pts || 0),
          dailyMultiplier: Number(row.daily_multiplier || 1), streakBonusPts: Number(row.streak_bonus_pts || 0),
        }});
      } else setUserPinned(null);
    } else if (m === "streak") {
      const { data } = await supabase.rpc("get_streak_leaderboard", {
        p_gender: genderParam, p_limit: 200,
        p_age_min: ageParams.min, p_age_max: ageParams.max, p_country: countryParam,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allStreakEntries = (data || []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userRow = allStreakEntries.find((r: any) => (r.out_user_id || r.user_id) === profile.id);
      if (userRow) {
        const rank = allStreakEntries.indexOf(userRow) + 1;
        const longest = Number(userRow.out_longest_streak || userRow.longest_streak || 0);
        const current = Number(userRow.out_current_streak || userRow.current_streak || 0);
        setUserPinned({ rank, entry: {
          userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url,
          metric: "streak", primaryValue: longest,
          secondaryLabel: longest === 1 ? "day" : "days",
          currentStreak: current,
        }});
      } else setUserPinned(null);
    } else if (m === "session") {
      const { data } = await supabase.rpc("get_best_session_leaderboard", {
        p_gender: genderParam, p_limit: 200, p_period: period,
        p_age_min: ageParams.min, p_age_max: ageParams.max, p_country: countryParam,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allSessionEntries = (data || []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userRow = allSessionEntries.find((r: any) => r.user_id === profile.id);
      if (userRow) {
        const rank = allSessionEntries.indexOf(userRow) + 1;
        setUserPinned({ rank, entry: {
          userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url,
          metric: "session", primaryValue: Number(userRow.rep_count), secondaryLabel: "repps",
          durationSeconds: Number(userRow.duration_seconds),
        }});
      } else setUserPinned(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, gender, period, ageBracket, countryFilter]);

  const resolveUserPinned = useCallback((entries: IndividualEntry[], m: Metric) => {
    if (!profile) { setUserPinned(null); return; }
    const userMatchesFilter = gender === "all" || profile.gender === gender;
    if (!userMatchesFilter) { setUserPinned(null); return; }
    const idx = entries.findIndex(e => e.userId === profile.id);
    if (idx >= 0) { setUserPinned(null); return; }
    fetchUserPinnedData(m);
  }, [profile, gender, fetchUserPinnedData]);

  const resolveTeamPinned = useCallback((entries: TeamEntry[]) => {
    if (!profile?.team_id) { setTeamPinned(null); return; }
    const idx = entries.findIndex(e => e.teamId === profile.team_id);
    if (idx >= 0) { setTeamPinned(null); return; }
    setTeamPinned(null);
  }, [profile]);

  // ── Individual fetchers ─────────────────────────────────────

  const fetchIndividualReps = useCallback(async () => {
    const { data } = await supabase.rpc("get_leaderboard", {
      p_gender: gender === "all" ? null : gender,
      p_period: period,
      p_limit: 50,
      p_age_min: ageParams.min,
      p_age_max: ageParams.max,
      p_country: countryFilter || null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: IndividualEntry[] = (data || []).map((r: any) => ({
      userId: r.user_id, name: r.name, avatarUrl: r.avatar_url,
      metric: "reps" as Metric, primaryValue: Number(r.rep_count), secondaryLabel: "repps",
    }));
    setIndividualEntries(mapped);
    resolveUserPinned(mapped, "reps");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, period, ageBracket, countryFilter, profile]);

  const fetchIndividualScore = useCallback(async () => {
    const { data } = await supabase.rpc("get_rep_score_leaderboard", {
      p_gender: gender === "all" ? null : gender,
      p_period: period,
      p_limit: 50,
      p_age_min: ageParams.min,
      p_age_max: ageParams.max,
      p_country: countryFilter || null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: IndividualEntry[] = (data || []).map((r: any) => ({
      userId: r.user_id, name: r.name, avatarUrl: r.avatar_url,
      metric: "score" as Metric, primaryValue: Number(r.score), secondaryLabel: "pts",
      baseReps: Number(r.base_reps), dailyMultiplierPts: Number(r.daily_multiplier_pts || 0),
      dailyMultiplier: Number(r.daily_multiplier || 1), streakBonusPts: Number(r.streak_bonus_pts || 0),
      teamStreakBonusPts: Number(r.team_streak_bonus_pts || 0), weeklyMultiplierPts: Number(r.weekly_multiplier_pts || 0),
    }));
    setIndividualEntries(mapped);
    resolveUserPinned(mapped, "score");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, period, ageBracket, countryFilter, profile]);

  const fetchIndividualStreak = useCallback(async () => {
    const { data } = await supabase.rpc("get_streak_leaderboard", {
      p_gender: gender === "all" ? null : gender,
      p_limit: 50,
      p_age_min: ageParams.min,
      p_age_max: ageParams.max,
      p_country: countryFilter || null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: IndividualEntry[] = (data || []).map((r: any) => ({
      userId: r.out_user_id, name: r.out_name, avatarUrl: r.out_avatar_url,
      metric: "streak" as Metric, primaryValue: Number(r.out_longest_streak),
      secondaryLabel: Number(r.out_longest_streak) === 1 ? "day" : "days",
      currentStreak: Number(r.out_current_streak),
    }));
    setIndividualEntries(mapped);
    resolveUserPinned(mapped, "streak");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, ageBracket, countryFilter, profile]);

  const fetchIndividualSession = useCallback(async () => {
    const { data } = await supabase.rpc("get_best_session_leaderboard", {
      p_gender: gender === "all" ? null : gender,
      p_limit: 50,
      p_age_min: ageParams.min,
      p_age_max: ageParams.max,
      p_country: countryFilter || null,
      p_period: period,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: IndividualEntry[] = (data || []).map((r: any) => ({
      userId: r.user_id, name: r.name, avatarUrl: r.avatar_url,
      metric: "session" as Metric, primaryValue: Number(r.rep_count), secondaryLabel: "repps",
      durationSeconds: Number(r.duration_seconds),
    }));
    setIndividualEntries(mapped);
    resolveUserPinned(mapped, "session");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, period, ageBracket, countryFilter, profile]);

  // ── Team fetchers ───────────────────────────────────────────

  const fetchTeamScore = useCallback(async () => {
    const { data } = await supabase.rpc("get_team_score_leaderboard", {
      p_period: period, p_limit: 50,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: TeamEntry[] = (data || []).map((r: any) => ({
      teamId: r.team_id, teamName: r.team_name, teamLogoUrl: r.team_logo_url || null,
      metric: "score" as Metric, primaryValue: Number(r.combined_score), secondaryLabel: "pts",
      members: (r.member_scores || []).map((m: { user_id: string; name: string; avatar_url: string | null; score: number; base_reps?: number }) => ({
        user_id: m.user_id, name: m.name, avatar_url: m.avatar_url,
        value: Number(m.score), secondary: Number(m.base_reps || 0),
      })),
    }));
    setTeamEntries(mapped);
    resolveTeamPinned(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, gender, ageBracket, profile]);

  const fetchTeamReps = useCallback(async () => {
    const { data } = await supabase.rpc("get_team_reps_leaderboard", {
      p_period: period, p_limit: 50,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: TeamEntry[] = (data || []).map((r: any) => ({
      teamId: r.team_id, teamName: r.team_name, teamLogoUrl: r.team_logo_url || null,
      metric: "reps" as Metric, primaryValue: Number(r.combined_reps), secondaryLabel: "repps",
      members: (r.member_reps || []).map((m: { user_id: string; name: string; avatar_url: string | null; rep_count: number }) => ({
        user_id: m.user_id, name: m.name, avatar_url: m.avatar_url, value: Number(m.rep_count),
      })),
    }));
    setTeamEntries(mapped);
    resolveTeamPinned(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, gender, ageBracket, profile]);

  const fetchTeamStreak = useCallback(async () => {
    const { data } = await supabase.rpc("get_team_streak_leaderboard", {
      p_limit: 50,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: TeamEntry[] = (data || []).map((r: any) => ({
      teamId: r.out_team_id, teamName: r.out_team_name, teamLogoUrl: r.out_team_logo_url || null,
      metric: "streak" as Metric, primaryValue: Number(r.out_longest_streak),
      secondaryLabel: Number(r.out_longest_streak) === 1 ? "day" : "days",
      currentStreak: Number(r.out_current_streak), members: [],
    }));
    setTeamEntries(mapped);
    resolveTeamPinned(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, ageBracket, profile]);

  const fetchTeamSession = useCallback(async () => {
    const { data } = await supabase.rpc("get_team_session_leaderboard", {
      p_limit: 50, p_period: period,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: TeamEntry[] = (data || []).map((r: any) => ({
      teamId: r.out_team_id, teamName: r.out_team_name, teamLogoUrl: r.out_team_logo_url || null,
      metric: "session" as Metric, primaryValue: Number(r.out_rep_count), secondaryLabel: "repps",
      bestMemberName: r.out_best_member_name, durationSeconds: Number(r.out_duration_seconds || 0), members: [],
    }));
    setTeamEntries(mapped);
    resolveTeamPinned(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, gender, ageBracket, profile]);

  // ── Country fetcher ──────────────────────────────────────────

  const fetchCountryLeaderboard = useCallback(async () => {
    const metricParam = metric === "consistency" ? "reps" : metric;
    const { data } = await supabase.rpc("get_country_leaderboard", {
      p_metric: metricParam,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
      p_period: period, p_limit: 50,
    });
    const secondaryLabels: Record<string, string> = {
      reps: "repps", score: "pts", streak: "days", session: "repps",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: CountryEntry[] = (data || []).map((r: any) => ({
      countryCode: r.out_country_code,
      countryName: COUNTRY_MAP.get(r.out_country_code) || r.out_country_code,
      metric: metricParam as Metric,
      primaryValue: Number(r.out_metric_value),
      secondaryLabel: secondaryLabels[metricParam] || "pts",
      memberCount: Number(r.out_member_count),
    }));
    setCountryEntries(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, gender, ageBracket, period]);

  // ── Consistency fetcher ──────────────────────────────────────

  const fetchConsistency = useCallback(async () => {
    const scopeParam = scope === "country" ? "country" : scope === "team" ? "team" : "individual";
    const { data } = await supabase.rpc("get_consistency_leaderboard", {
      p_scope: scopeParam,
      p_gender: gender === "all" ? null : gender,
      p_age_min: ageParams.min, p_age_max: ageParams.max,
      p_country: scope === "individual" ? (countryFilter || null) : null,
      p_period: period, p_limit: 50,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: ConsistencyEntry[] = (data || []).map((r: any) => ({
      entityId: r.out_entity_id,
      name: scope === "country" ? (COUNTRY_MAP.get(r.out_entity_id) || r.out_entity_id) : r.out_name,
      avatarUrl: r.out_avatar_url,
      consistencyScore: Number(r.out_consistency_score),
      qualifyingWeeks: Number(r.out_qualifying_weeks),
      avgWeeklyReps: Number(r.out_avg_weekly_reps),
      totalReps: Number(r.out_total_reps),
    }));
    setConsistencyEntries(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, gender, ageBracket, countryFilter, period]);

  // ── Heatmap fetcher ─────────────────────────────────────────

  const fetchHeatmap = useCallback(async (tab: "global" | "mine") => {
    const cache = heatmapCacheRef.current[tab];
    if (cache && Date.now() - cache.at < 300_000) {
      if (tab === "global") setHeatmapGlobal(cache.data);
      else setHeatmapMine(cache.data);
      return;
    }
    setHeatmapLoading(true);
    const { data } = await supabase.rpc("get_activity_heatmap", {
      p_scope: tab === "global" ? "global" : "personal",
      p_user_id: tab === "mine" && profile ? profile.id : null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cells: HeatmapCell[] = (data || []).map((r: any) => ({
      day: Number(r.out_day_of_week),
      hour: Number(r.out_hour),
      count: Number(r.out_rep_count),
    }));
    heatmapCacheRef.current[tab] = { data: cells, at: Date.now() };
    if (tab === "global") setHeatmapGlobal(cells);
    else setHeatmapMine(cells);
    setHeatmapLoading(false);
  }, [profile]);

  useEffect(() => {
    if (heatmapOpen) fetchHeatmap(heatmapTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapOpen, heatmapTab]);



  // ── Computed pinned for in-list users ───────────────────────

  const pinnedData = (() => {
    if (scope === "individual") {
      if (userPinned) return userPinned;
      if (!profile) return null;
      const idx = individualEntries.findIndex(e => e.userId === profile.id);
      if (idx === -1) return null;
      return { rank: idx + 1, entry: individualEntries[idx] };
    }
    if (scope === "team") {
      if (teamPinned) return teamPinned;
      if (!profile?.team_id) return null;
      const idx = teamEntries.findIndex(e => e.teamId === profile.team_id);
      if (idx === -1) return null;
      return { rank: idx + 1, entry: teamEntries[idx] };
    }
    return null;
  })();

  const showPinnedCard = !userRowVisible && !loading && pinnedData !== null;

  // ── Fetch dispatcher ────────────────────────────────────────

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setExpandedTeamId(null);
    setConsistencyEntries([]);

    if (metric === "consistency") {
      setIndividualEntries([]); setTeamEntries([]); setCountryEntries([]);
      setUserPinned(null); setTeamPinned(null);
      if (period === "daily") {
        // Consistency requires at least a week — show message, don't fetch
      } else {
        await fetchConsistency();
      }
    } else if (scope === "individual") {
      setTeamEntries([]); setCountryEntries([]);
      setTeamPinned(null);
      if (metric === "reps") await fetchIndividualReps();
      else if (metric === "score") await fetchIndividualScore();
      else if (metric === "streak") await fetchIndividualStreak();
      else if (metric === "session") await fetchIndividualSession();
    } else if (scope === "team") {
      setIndividualEntries([]); setCountryEntries([]);
      setUserPinned(null);
      if (metric === "score") await fetchTeamScore();
      else if (metric === "reps") await fetchTeamReps();
      else if (metric === "streak") await fetchTeamStreak();
      else if (metric === "session") await fetchTeamSession();
    } else if (scope === "country") {
      setIndividualEntries([]); setTeamEntries([]);
      setUserPinned(null); setTeamPinned(null);
      await fetchCountryLeaderboard();
    }

    setLoading(false);
  }, [scope, metric, period, fetchIndividualReps, fetchIndividualScore, fetchIndividualStreak, fetchIndividualSession, fetchTeamScore, fetchTeamReps, fetchTeamStreak, fetchTeamSession, fetchCountryLeaderboard, fetchConsistency]);

  useEffect(() => {
    fetchTotalReps();
    fetchLatestReps();
    fetchBoard();
  }, [fetchBoard, fetchTotalReps, fetchLatestReps]);

  // ── Realtime ────────────────────────────────────────────────

  useRepsChannel(
    useCallback(() => {
      setTotalReps((prev) => prev + 1);
      setHasRecentActivity(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchLatestReps();
        fetchBoard();
      }, 2000);
    }, [fetchBoard, fetchLatestReps])
  );

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // ── IntersectionObserver for pinned card ─────────────────────

  useEffect(() => {
    const el = userRowRef.current;
    const root = scrollContainerRef.current;
    if (!el || !root) { setUserRowVisible(true); return; }
    const observer = new IntersectionObserver(
      ([entry]) => setUserRowVisible(entry.isIntersecting),
      { root, threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scope, metric, period, gender, ageBracket, countryFilter, loading, individualEntries, teamEntries, userPinned, teamPinned]);

  const scrollToUserRow = () => {
    userRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ── Scope/metric handlers ───────────────────────────────────

  const handleScopeChange = (s: Scope) => {
    setScope(s);
    setMetric("reps");
    setExpandedTeamId(null);
  };

  const handleFilterApply = (f: FilterState) => {
    setPeriod(f.period);
    setGender(f.gender);
    setAgeBracket(f.ageBracket);
    setCountryFilter(f.country);
  };

  // ── Derived state ───────────────────────────────────────────

  const entries = scope === "individual" ? individualEntries : [];
  const teams = scope === "team" ? teamEntries : [];
  const countries = scope === "country" ? countryEntries : [];
  const isConsistencyToday = metric === "consistency" && period === "daily";
  const isEmpty = metric === "consistency"
    ? isConsistencyToday || consistencyEntries.length === 0
    : scope === "individual"
      ? entries.length === 0 && !userPinned
      : scope === "team"
        ? teams.length === 0 && !teamPinned
        : countries.length === 0;

  // ── Render helpers ──────────────────────────────────────────

  const renderRankBadge = (i: number) =>
    i < 3
      ? <span className="text-body-lg">{MEDALS[i]}</span>
      : <span className="text-body text-ink-muted">{i + 1}.</span>;

  const renderTeamAvatar = (logoUrl: string | null) =>
    logoUrl ? (
      <img src={logoUrl} alt="" referrerPolicy="no-referrer" className="ml-2 w-8 h-8 rounded-full object-cover flex-shrink-0" />
    ) : (
      <div className="ml-2 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
    );

  // ── Individual row ──────────────────────────────────────────

  const renderIndividualRow = (entry: IndividualEntry, i: number, isUserRow: boolean, isPinnedRow: boolean) => {
    const isMe = profile && entry.userId === profile.id;
    return (
      <div key={entry.userId} ref={isMe || isUserRow ? userRowRef : undefined}>
        <button
          onClick={isPinnedRow ? scrollToUserRow : () => {
            if (isMe) navigate("/profile");
            else navigate(`/user/${entry.userId}`);
          }}
          className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMe || isUserRow ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
        >
          <span className="w-8 text-center flex-shrink-0">
            {isUserRow ? (
              <span className="text-body text-accent font-bold">#{i + 1}</span>
            ) : renderRankBadge(i)}
          </span>
          <div className="ml-2">
            <Avatar url={entry.avatarUrl} name={entry.name} />
          </div>
          <div className="ml-3 flex-1 min-w-0">
            <span className="text-body text-ink-primary truncate flex items-center gap-1">
              {entry.name}
              {ogIds.has(entry.userId) && <OGBadge />}
            </span>
            {entry.metric === "score" && entry.baseReps !== undefined && (
              <div className="flex flex-wrap gap-x-2 gap-y-0">
                <span className="text-micro text-ink-muted">{formatNumber(entry.baseReps)} base</span>
                {(entry.dailyMultiplierPts || 0) > 0 && (
                  <span className="text-micro text-accent">+{formatNumber(entry.dailyMultiplierPts!)} {entry.dailyMultiplier}x</span>
                )}
                {(entry.streakBonusPts || 0) > 0 && (
                  <span className="text-micro text-accent">+{formatNumber(entry.streakBonusPts!)} streak</span>
                )}
                {(entry.teamStreakBonusPts || 0) > 0 && (
                  <span className="text-micro text-accent">+{formatNumber(entry.teamStreakBonusPts!)} team</span>
                )}
                {(entry.weeklyMultiplierPts || 0) > 0 && (
                  <span className="text-micro text-accent">+{formatNumber(entry.weeklyMultiplierPts!)} weekly</span>
                )}
              </div>
            )}
            {entry.metric === "session" && (entry.durationSeconds || 0) > 0 && (
              <span className="text-micro text-ink-muted">
                {formatSessionDuration(entry.durationSeconds!)} · {(entry.primaryValue / (entry.durationSeconds! / 60)).toFixed(1)}/min
              </span>
            )}
            {entry.metric === "streak" && (entry.currentStreak || 0) > 0 && (
              <span className="text-micro text-accent">{entry.currentStreak}d active</span>
            )}
          </div>
          <div className="text-right ml-2">
            <span className="text-body text-accent font-bold tabular-nums">
              {entry.metric === "score" ? formatNumber(entry.primaryValue) : entry.primaryValue}
            </span>
            <span className="text-micro text-ink-muted block">{entry.secondaryLabel}</span>
          </div>
        </button>
      </div>
    );
  };

  // ── Team row ────────────────────────────────────────────────

  const renderTeamRow = (entry: TeamEntry, i: number, isUserRow: boolean, isPinnedRow: boolean) => {
    const isMyTeam = profile?.team_id && entry.teamId === profile.team_id;
    const hasMembers = entry.members.length > 0;
    return (
      <div key={entry.teamId} ref={isMyTeam || isUserRow ? userRowRef : undefined}>
        <button
          onClick={isPinnedRow ? scrollToUserRow : () => hasMembers && setExpandedTeamId(expandedTeamId === entry.teamId ? null : entry.teamId)}
          className={`w-full flex items-center py-3 px-4 rounded-lg text-left ${isMyTeam || isUserRow ? "bg-bg-elevated border-l-2 border-accent" : "bg-bg-surface"}`}
        >
          <span className="w-8 text-center flex-shrink-0">
            {isUserRow ? (
              <span className="text-body text-accent font-bold">#{i + 1}</span>
            ) : renderRankBadge(i)}
          </span>
          {renderTeamAvatar(entry.teamLogoUrl)}
          <div className="ml-3 flex-1 min-w-0">
            <span className="text-body text-ink-primary truncate block">{entry.teamName}</span>
            {entry.metric === "session" && entry.bestMemberName && (
              <span className="text-micro text-ink-muted">by {entry.bestMemberName}</span>
            )}
            {entry.metric === "streak" && (entry.currentStreak || 0) > 0 && (
              <span className="text-micro text-accent">{entry.currentStreak}d active</span>
            )}
            {entry.metric !== "session" && entry.metric !== "streak" && (
              <span className="text-micro text-ink-muted">{entry.members.length} members</span>
            )}
          </div>
          <div className="text-right ml-2 flex items-center gap-2">
            {entry.metric === "session" && (entry.durationSeconds || 0) > 0 && (
              <span className="text-micro text-ink-muted">{formatSessionDuration(entry.durationSeconds!)}</span>
            )}
            <div className="text-right">
              <span className="text-body text-accent font-bold tabular-nums">
                {entry.metric === "score" ? formatNumber(entry.primaryValue) : entry.primaryValue}
              </span>
              <span className="text-micro text-ink-muted block">{entry.secondaryLabel}</span>
            </div>
            {hasMembers && (
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`text-ink-muted transition-transform duration-200 ${expandedTeamId === entry.teamId ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            )}
          </div>
        </button>
        {expandedTeamId === entry.teamId && entry.members.length > 0 && (
          <div className="ml-10 mt-1 flex flex-col gap-1">
            {[...entry.members].sort((a, b) => b.value - a.value).map((m) => (
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
                {m.secondary !== undefined && (
                  <span className="text-micro text-ink-secondary tabular-nums ml-2">{formatNumber(m.secondary)}</span>
                )}
                <span className="text-caption text-accent font-bold tabular-nums ml-2">{formatNumber(m.value)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Loading skeleton ────────────────────────────────────────

  const renderSkeleton = () => (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center py-3 px-4 rounded-lg bg-bg-surface animate-pulse">
          <div className="w-8 h-5 bg-bg-input rounded" />
          <div className="ml-2 w-8 h-8 bg-bg-input rounded-full" />
          <div className="ml-3 flex-1 h-4 bg-bg-input rounded" />
          <div className="ml-2 w-12 h-4 bg-bg-input rounded" />
        </div>
      ))}
    </div>
  );

  // ── Main render ─────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-shrink-0 bg-bg-base">
        {/* GBT header */}
        <div className="relative flex flex-col items-center mt-2 mb-4">
          <img
            src={getMascot(theme, "pumped")}
            alt=""
            className="absolute w-[4.5rem] left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <button
              onClick={() => { setHeatmapOpen(true); setHeatmapTab("global"); }}
              className="w-10 h-10 flex items-center justify-center"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="text-ink-secondary">
                {[0, 1, 2, 3].map(row =>
                  [0, 1, 2].map(col => (
                    <circle key={`${row}-${col}`} cx={3 + col * 5} cy={3 + row * 3.5} r={1.5} fill="currentColor" />
                  ))
                )}
              </svg>
            </button>
            <button
              onClick={() => { setShowLatest(!showLatest); setHasRecentActivity(false); }}
              className="w-10 h-10 flex items-center justify-center"
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
          </div>
          <p className="text-headline text-ink-primary">GBT</p>
          <p className="text-display-lg repps-gradient-text mt-1 tabular-nums">{formatNumber(totalReps)}</p>
          <p className="text-micro text-ink-secondary uppercase tracking-wide mt-1">Global Burpee Total</p>
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

        {/* Scope pills */}
        <div className="flex gap-1 mb-2 bg-bg-surface rounded-pill p-1">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleScopeChange(tab.value)}
              className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                scope === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Metric pills */}
        <div className="flex justify-between mb-2 bg-bg-surface rounded-pill p-1">
          {METRIC_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setMetric(tab.value);
                if (tab.value === "consistency" && (period === "daily" || period === "weekly")) setPeriod("yearly");
              }}
              className={`py-2 px-2.5 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                metric === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter line */}
        <button
          onClick={() => setFilterSheetOpen(true)}
          className="flex items-center justify-between w-full px-3 py-2 mb-3 rounded-lg bg-bg-surface"
        >
          <div className="flex items-center gap-1.5 text-caption text-ink-secondary overflow-hidden">
            <span className="truncate">{filterLine.join(" · ")}</span>
            {nonDefaultFilterCount > 0 && (
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent text-ink-inverse text-micro font-bold flex items-center justify-center">
                {nonDefaultFilterCount}
              </span>
            )}
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-muted flex-shrink-0 ml-2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Scrollable list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
        {loading ? renderSkeleton() : isEmpty ? (
          <div className="py-12 text-center">
            <p className="text-body text-ink-muted">
              {isConsistencyToday
                ? "Consistency requires at least a week of data. Switch to a longer time period."
                : metric === "consistency"
                  ? "No one has hit consistency yet. 30 reps on 5 days in a week qualifies."
                  : scope === "country"
                    ? "No countries represented yet. Set your nationality in Profile to put your country on the board."
                    : "No activity yet. Be the first."}
            </p>
          </div>
        ) : metric === "consistency" ? (
          <div className="flex flex-col gap-2">
            {consistencyEntries.map((entry, i) => (
              <button
                key={entry.entityId}
                onClick={() => {
                  if (scope === "country") return;
                  if (scope === "team") return;
                  if (profile && entry.entityId === profile.id) navigate("/profile");
                  else navigate(`/user/${entry.entityId}`);
                }}
                className="w-full flex items-center py-3 px-4 rounded-lg bg-bg-surface text-left"
              >
                <span className="w-8 text-center flex-shrink-0">
                  {renderRankBadge(i)}
                </span>
                {scope === "country" ? (
                  <span className="ml-2 text-2xl flex-shrink-0">{flagEmoji(entry.entityId)}</span>
                ) : (
                  <div className="ml-2">
                    <Avatar url={entry.avatarUrl} name={entry.name} />
                  </div>
                )}
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate block">{entry.name}</span>
                  <span className="text-micro text-ink-muted">
                    {entry.qualifyingWeeks}w · {entry.avgWeeklyReps}/wk
                  </span>
                </div>
                <div className="text-right ml-2">
                  <span className="text-body text-accent font-bold tabular-nums">
                    {formatNumber(entry.consistencyScore)}
                  </span>
                  <span className="text-micro text-ink-muted block">score</span>
                </div>
              </button>
            ))}
          </div>
        ) : scope === "individual" ? (
          <div className="flex flex-col gap-2">
            {entries.map((entry, i) => renderIndividualRow(entry, i, false, false))}
            {userPinned && (
              <div className="pt-1 mt-1 border-t border-border-default">
                {renderIndividualRow(userPinned.entry, userPinned.rank - 1, true, false)}
              </div>
            )}
          </div>
        ) : scope === "team" ? (
          <div className="flex flex-col gap-2">
            {teams.map((entry, i) => renderTeamRow(entry, i, false, false))}
            {teamPinned && (
              <div className="pt-1 mt-1 border-t border-border-default">
                {renderTeamRow(teamPinned.entry, teamPinned.rank - 1, true, false)}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {countries.map((entry, i) => (
              <div key={entry.countryCode} className="flex items-center py-3 px-4 rounded-lg bg-bg-surface">
                <span className="w-8 text-center flex-shrink-0">
                  {renderRankBadge(i)}
                </span>
                <span className="ml-2 text-2xl flex-shrink-0">{flagEmoji(entry.countryCode)}</span>
                <div className="ml-3 flex-1 min-w-0">
                  <span className="text-body text-ink-primary truncate block">{entry.countryName}</span>
                  <span className="text-micro text-ink-muted">
                    {entry.memberCount} {entry.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                <div className="text-right ml-2">
                  <span className="text-body text-accent font-bold tabular-nums">
                    {metric === "score" ? formatNumber(entry.primaryValue) : entry.primaryValue}
                  </span>
                  <span className="text-micro text-ink-muted block">{entry.secondaryLabel}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pinned "YOU" card */}
      {showPinnedCard && pinnedData && (
        <div className="flex-shrink-0 pt-2 pb-1 bg-bg-base border-t border-border-default">
          {scope === "individual" && "userId" in pinnedData.entry && (
            renderIndividualRow(pinnedData.entry as IndividualEntry, pinnedData.rank - 1, true, true)
          )}
          {scope === "team" && "teamId" in pinnedData.entry && (
            renderTeamRow(pinnedData.entry as TeamEntry, pinnedData.rank - 1, true, true)
          )}
        </div>
      )}

      {/* Filter sheet */}
      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={{ period, gender, ageBracket, country: countryFilter }}
        onApply={handleFilterApply}
        showCountry={scope === "individual"}
      />

      {/* Heatmap bottom sheet */}
      {heatmapOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={() => setHeatmapOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-bg-elevated rounded-t-2xl border-t border-divider overflow-hidden"
            style={{ animation: "slideUp 0.3s ease-out", maxHeight: "65vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-ink-muted" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <p className="text-body text-ink-primary font-semibold">Rhythm Heatmap</p>
              <button onClick={() => setHeatmapOpen(false)} className="text-ink-muted p-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex gap-1 mx-5 mb-4 bg-bg-surface rounded-pill p-1">
              <button
                onClick={() => setHeatmapTab("global")}
                className={`flex-1 py-2 rounded-pill text-micro uppercase transition-colors duration-200 ease-apple ${
                  heatmapTab === "global" ? "bg-accent text-ink-inverse font-bold" : "text-ink-secondary"
                }`}
              >
                Global
              </button>
              {profile && (
                <button
                  onClick={() => setHeatmapTab("mine")}
                  className={`flex-1 py-2 rounded-pill text-micro uppercase transition-colors duration-200 ease-apple ${
                    heatmapTab === "mine" ? "bg-[#60A5FA] text-ink-inverse font-bold" : "text-ink-secondary"
                  }`}
                >
                  Mine
                </button>
              )}
            </div>
            <div className="px-5 pb-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
              {heatmapLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (heatmapTab === "global" ? heatmapGlobal : heatmapMine).length === 0 ? (
                <p className="text-center text-body text-ink-muted py-8">
                  No activity data yet. Do some burpees to see your rhythm.
                </p>
              ) : (
                <PunchcardChart
                  data={heatmapTab === "global" ? heatmapGlobal : heatmapMine}
                  color={heatmapTab === "global" ? accentColor : "#60A5FA"}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
