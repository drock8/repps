import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";

import { supabase } from "../lib/supabase";
import { formatNumber, MEDALS } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";
import ActivityFeed from "../components/ActivityFeed";
import { usePeopleMoving } from "../hooks/usePeopleMoving";
import { useRepsChannel } from "../hooks/useRepsChannel";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import YouTubeEmbed from "../components/YouTubeEmbed";
import { unlockAudio } from "../lib/repAudio";
import { useTheme } from "../contexts/ThemeContext";
import { getMascot } from "../lib/mascots";

function formatCountdown(targetDate: string): string {
  const now = new Date();
  const target = new Date(targetDate + "T23:59:59");
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "Target date reached!";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

// Persist last-known value so remounts never flash "0"
let cachedCount: number | null = null;

interface TeamMemberProgress {
  id: string;
  name: string;
  avatarUrl: string | null;
  todayCount: number;
}

interface TeamRankInfo {
  rank: number;
  teamName: string;
  teamScore: number;
  teamLogoUrl: string | null;
  insight: string | null;
}

interface FeaturedEvent {
  id: string;
  name: string;
  target_reps: number | null;
  total_reps: number;
  starts_at: string;
  ends_at: string;
  status: string;
  competition_mode: string;
}


function generateTeamInsight(
  rank: number,
  teamScore: number,
  allTeams: { teamId: string; teamName: string; combinedScore: number }[],
  myTeamId: string
): string | null {
  if (allTeams.length <= 1) return null;

  const myIdx = allTeams.findIndex((t) => t.teamId === myTeamId);
  if (myIdx < 0) return null;

  if (rank === 1 && allTeams.length > 1) {
    const gap = teamScore - allTeams[1].combinedScore;
    if (gap <= 20) {
      return `${allTeams[1].teamName} is only ${gap} pts behind — stay sharp!`;
    }
    return `Leading by ${gap} pts over ${allTeams[1].teamName}`;
  }

  if (myIdx > 0) {
    const teamAbove = allTeams[myIdx - 1];
    const gap = teamAbove.combinedScore - teamScore;
    if (gap <= 30) {
      return `Only ${gap} pts from overtaking ${teamAbove.teamName} for #${myIdx}!`;
    }
    return `${gap} pts behind ${teamAbove.teamName} (#${myIdx})`;
  }

  return null;
}

export default function Home() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const theme = useTheme();

  const [totalReps, setTotalReps] = useState(cachedCount ?? 0);
  const animatedCount = useAnimatedCounter(totalReps);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryCount = 0;

    async function fetchData() {
      try {
        const { count, error } = await supabase
          .from("reps")
          .select("*", { count: "exact", head: true });

        if (!mountedRef.current) return;

        if (count !== null) {
          cachedCount = count;
          setTotalReps(count);
        }

        if (error) {
          retryCount++;
          retryTimeout = setTimeout(fetchData, Math.min(2000 * retryCount, 10000));
        } else {
          retryCount = 0;
        }
      } catch {
        if (mountedRef.current) {
          retryCount++;
          retryTimeout = setTimeout(fetchData, Math.min(2000 * retryCount, 10000));
        }
      }
    }

    fetchData();

    // Refetch when tab/app becomes visible again (handles phone sleep, tab switch)
    function handleVisibility() {
      if (document.visibilityState === "visible") fetchData();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(retryTimeout);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const [teamMembers, setTeamMembers] = useState<TeamMemberProgress[]>([]);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [teamRank, setTeamRank] = useState<TeamRankInfo | null>(null);
  const [featuredEvent, setFeaturedEvent] = useState<FeaturedEvent | null>(null);

  useEffect(() => {
    async function fetchFeatured() {
      const { data } = await supabase
        .from("events")
        .select("id, name, target_reps, starts_at, ends_at, status, competition_mode")
        .eq("is_featured", true)
        .in("status", ["announced", "active"])
        .limit(1)
        .maybeSingle();

      if (!data) { setFeaturedEvent(null); return; }

      const now = Date.now();
      let status = data.status;
      if (status === "announced" && new Date(data.starts_at).getTime() <= now) {
        await supabase.from("events").update({ status: "active" }).eq("id", data.id);
        status = "active";
      }
      if (status === "active" && new Date(data.ends_at).getTime() <= now) {
        await supabase.rpc("complete_event", { p_event_id: data.id });
        setFeaturedEvent(null);
        return;
      }

      const { data: progress } = await supabase.rpc("get_event_progress", { p_event_id: data.id });
      setFeaturedEvent({
        ...data,
        status,
        total_reps: progress?.total_reps ?? 0,
      });
    }
    fetchFeatured();
  }, []);

  const fetchTeamProgress = useCallback(async () => {
    if (!profile?.team_id) {
      setTeamMembers([]);
      setTeamRank(null);
      return;
    }

    const [membersRes, settingRes, teamRes, leaderboardRes] = await Promise.all([
      supabase.from("profiles").select("id, name, avatar_url").eq("team_id", profile.team_id),
      supabase.from("settings").select("value").eq("key", "team_daily_target").single(),
      supabase.from("teams").select("name, logo_url").eq("id", profile.team_id).single(),
      supabase.rpc("get_team_score_leaderboard", { p_period: "all", p_limit: 50 }),
    ]);

    const target = settingRes.data ? Number(settingRes.data.value) : 5;
    setDailyTarget(target);

    if (leaderboardRes.data && teamRes.data) {
      const allTeams = (leaderboardRes.data as { team_id: string; team_name: string; combined_score: number }[]).map((r) => ({
        teamId: r.team_id,
        teamName: r.team_name,
        combinedScore: Number(r.combined_score),
      }));
      const myIdx = allTeams.findIndex((t) => t.teamId === profile.team_id);
      const rank = myIdx >= 0 ? myIdx + 1 : 0;
      const score = myIdx >= 0 ? allTeams[myIdx].combinedScore : 0;
      setTeamRank({
        rank,
        teamName: teamRes.data.name,
        teamScore: score,
        teamLogoUrl: teamRes.data.logo_url || null,
        insight: rank > 0 ? generateTeamInsight(rank, score, allTeams, profile.team_id!) : null,
      });
    } else if (teamRes.data) {
      setTeamRank({ rank: 0, teamName: teamRes.data.name, teamScore: 0, teamLogoUrl: teamRes.data.logo_url || null, insight: null });
    }

    if (!membersRes.data) return;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const memberIds = membersRes.data.map((m: { id: string }) => m.id);

    const { data: repsData } = await supabase
      .from("reps")
      .select("user_id")
      .in("user_id", memberIds)
      .gte("validated_at", todayStart.toISOString());

    const countMap: Record<string, number> = {};
    (repsData || []).forEach((r: { user_id: string }) => {
      countMap[r.user_id] = (countMap[r.user_id] || 0) + 1;
    });

    setTeamMembers(
      membersRes.data.map((m: { id: string; name: string; avatar_url: string | null }) => ({
        id: m.id,
        name: m.name,
        avatarUrl: m.avatar_url,
        todayCount: countMap[m.id] || 0,
      }))
    );
  }, [profile?.team_id]);

  useEffect(() => {
    fetchTeamProgress();
  }, [fetchTeamProgress]);

  const { moverCount, handleNewRep, refetchMovers } = usePeopleMoving();

  useRepsChannel(
    (payload) => {
      setTotalReps((prev) => {
        const next = prev + 1;
        cachedCount = next;
        return next;
      });
      handleNewRep(payload.user_id);
      fetchTeamProgress();
    },
    () => {
      supabase.from("reps").select("*", { count: "exact", head: true }).then(({ count }) => {
        if (count !== null && mountedRef.current) {
          cachedCount = count;
          setTotalReps(count);
        }
      });
      refetchMovers();
      fetchTeamProgress();
    }
  );
  const animatedMovers = useAnimatedCounter(moverCount, 200);

  const MILESTONE_TARGET = 1000;
  const MILESTONE_DATE = "2026-06-06";
  const milestonePercent = Math.min((totalReps / MILESTONE_TARGET) * 100, 100);

  return (
    <div className="flex flex-col items-center text-center h-full">
      {/* Three-stat row */}
      <div className="grid grid-cols-3 gap-2 w-full px-2">
        <div className="text-center">
          <p className="text-micro text-ink-muted uppercase tracking-wide">GBT</p>
          <p className="text-display-md repps-gradient-text tabular-nums leading-tight mt-0.5">
            {formatNumber(animatedCount)}
          </p>
          <p className="text-micro text-ink-secondary mt-0.5"><span className="text-accent font-semibold">verified</span> burpees</p>
        </div>
        <div className="text-center">
          <p className="text-micro text-ink-muted uppercase tracking-wide">TARGET</p>
          <p className="text-display-md text-ink-primary tabular-nums leading-tight mt-0.5">
            {formatNumber(MILESTONE_TARGET)}
          </p>
          <p className="text-micro text-ink-secondary mt-0.5">by Jun 6</p>
          <p className="text-micro text-accent font-semibold">{formatCountdown(MILESTONE_DATE)}</p>
        </div>
        <div className="text-center">
          <p className="text-micro text-ink-muted uppercase tracking-wide flex items-center justify-center gap-1">
            TPM
            <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-ink-muted/20 text-ink-muted text-[8px] font-bold leading-none cursor-default" title="Total People Moving">i</span>
          </p>
          <p className="text-display-md text-accent tabular-nums leading-tight mt-0.5">
            {formatNumber(animatedMovers)}
          </p>
          <p className="text-micro text-ink-secondary mt-0.5">people</p>
          <p className="text-micro text-ink-muted">(of 1M)</p>
        </div>
      </div>

      {/* Milestone progress bar */}
      <div className="w-full px-4 mt-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-bg-input rounded-pill overflow-hidden">
            <div
              className="h-full bg-accent rounded-pill transition-all duration-600 ease-apple"
              style={{ width: `${milestonePercent}%` }}
            />
          </div>
          <p className="text-micro text-accent font-bold tabular-nums whitespace-nowrap">
            {milestonePercent.toFixed(1)}%
          </p>
        </div>
      </div>


      {featuredEvent && (
        <Link
          to={`/events/${featuredEvent.id}`}
          className="w-full px-4 mt-3 block"
        >
          <div className="bg-bg-surface rounded-lg px-4 py-3 transition-all duration-200 ease-apple active:scale-[0.98]">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-micro text-accent font-bold uppercase tracking-wide flex items-center gap-1">
                  <span>🔥</span> Featured Event
                </p>
                <p className="text-body text-ink-primary font-semibold mt-1 truncate">{featuredEvent.name}</p>
                <div className="flex items-center gap-2 mt-2">
                  {featuredEvent.target_reps ? (
                    <>
                      <div className="flex-1 h-1.5 bg-bg-input rounded-pill overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-pill transition-all duration-300 ease-apple"
                          style={{ width: `${Math.min(100, (featuredEvent.total_reps / featuredEvent.target_reps) * 100)}%` }}
                        />
                      </div>
                      <span className="text-micro text-ink-muted tabular-nums whitespace-nowrap">
                        {Math.round(Math.min(100, (featuredEvent.total_reps / featuredEvent.target_reps) * 100))}%
                      </span>
                    </>
                  ) : null}
                  <span className="text-micro text-ink-muted whitespace-nowrap">
                    {(() => {
                      const diff = new Date(featuredEvent.ends_at).getTime() - Date.now();
                      if (diff <= 0) return "Ending";
                      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                      return d > 0 ? `${d}d remaining` : `${h}h remaining`;
                    })()}
                  </span>
                </div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted flex-shrink-0 ml-3">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
        </Link>
      )}

      {teamMembers.length > 0 && (
        <div className="w-full px-4 mt-3">
          <div className="flex items-center justify-between bg-bg-surface rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              {teamRank?.teamLogoUrl ? (
                <img
                  src={teamRank.teamLogoUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                    <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
                  </svg>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  {teamRank && teamRank.rank > 0 && (
                    <span className="text-body-lg leading-none flex-shrink-0">
                      {teamRank.rank <= 3 ? MEDALS[teamRank.rank - 1] : (
                        <span className="text-caption text-ink-muted font-bold">#{teamRank.rank}</span>
                      )}
                    </span>
                  )}
                  <span className="text-caption text-ink-primary font-bold truncate">
                    {teamRank?.teamName ?? "Team"}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-caption text-accent font-bold tabular-nums">
                    {teamMembers.reduce((sum, m) => sum + m.todayCount, 0)} repps
                  </span>
                  <span className="text-micro text-ink-muted">today</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {teamMembers.map((m) => {
                const hit = m.todayCount >= dailyTarget;
                return (
                  <div key={m.id} className="relative flex flex-col items-center" title={`${m.name}: ${m.todayCount}/${dailyTarget}`}>
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className={`w-7 h-7 rounded-full object-cover ${hit ? "ring-2 ring-accent" : "opacity-40"}`}
                      />
                    ) : (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        hit ? "bg-accent text-ink-inverse ring-2 ring-accent" : "bg-bg-elevated text-ink-muted opacity-40"
                      }`}>
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 min-w-[1rem] h-4 rounded-full flex items-center justify-center px-0.5 ${
                      hit ? "bg-accent" : "bg-ink-muted/60"
                    }`}>
                      <span className="text-[9px] font-bold text-white tabular-nums leading-none">
                        {m.todayCount}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {teamRank?.insight && (
            <div className="mt-1.5 px-1">
              <p className="text-micro text-ink-secondary italic">
                {teamRank.insight}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 w-full">
        <ActivityFeed />
      </div>

      <div className="mt-2 flex flex-col items-center">
        <div className="flex flex-col items-center">
          <div className="relative">
            <button
              onClick={() => { unlockAudio(); navigate("/dab"); }}
              className="cta-button w-[9.5rem] h-[9.5rem] rounded-full bg-accent text-ink-inverse font-extrabold italic text-[28px] flex items-center justify-center text-center leading-[1.1] transition-all duration-200 ease-apple active:scale-95 active:!shadow-[0_0_40px_8px_rgba(var(--color-accent-glow-secondary),0.4)] active:!animate-none"
            >
              <span className="flex flex-col items-center leading-none">
                <span>DAB</span>
                <span className="text-[10px] font-semibold not-italic tracking-wide opacity-80 my-0.5">Drop A Burpee</span>
                <span>NOW</span>
              </span>
            </button>
            <img
              src={getMascot(theme, "dab")}
              alt=""
              className="absolute w-[5.5rem] -right-8 -top-6 pointer-events-none"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <YouTubeEmbed videoId="pZpr_WPCzf4" compact />
      </div>
    </div>
  );
}
