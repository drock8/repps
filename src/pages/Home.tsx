import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import ActivityFeed from "../components/ActivityFeed";
import { usePeopleMoving } from "../hooks/usePeopleMoving";
import { useRepsChannel } from "../hooks/useRepsChannel";
import YouTubeEmbed from "../components/YouTubeEmbed";
import { unlockAudio } from "../lib/repAudio";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

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

function useAnimatedCounter(target: number, duration = 600) {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = currentRef.current;
    if (from === target) return;

    const start = performance.now();
    const diff = target - from;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const value = Math.round(from + diff * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        currentRef.current = target;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

// Persist last-known value so remounts never flash "0"
let cachedCount: number | null = null;

interface TeamMemberProgress {
  id: string;
  name: string;
  avatarUrl: string | null;
  todayCount: number;
}

export default function Home() {
  const navigate = useNavigate();
  const { profile } = useAuth();

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

  const fetchTeamProgress = useCallback(async () => {
    if (!profile?.team_id) {
      setTeamMembers([]);
      return;
    }

    const [membersRes, settingRes] = await Promise.all([
      supabase.from("profiles").select("id, name, avatar_url").eq("team_id", profile.team_id),
      supabase.from("settings").select("value").eq("key", "team_daily_target").single(),
    ]);

    const target = settingRes.data ? Number(settingRes.data.value) : 5;
    setDailyTarget(target);

    if (!membersRes.data) return;

    const today = new Date().toISOString().slice(0, 10);
    const memberIds = membersRes.data.map((m: { id: string }) => m.id);

    const { data: repsData } = await supabase
      .from("reps")
      .select("user_id")
      .in("user_id", memberIds)
      .gte("validated_at", today + "T00:00:00Z")
      .lt("validated_at", today + "T23:59:59.999Z");

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
  const MILESTONE_DATE = "2026-05-31";
  const milestonePercent = Math.min((totalReps / MILESTONE_TARGET) * 100, 100);

  return (
    <div className="flex flex-col items-center text-center h-full pt-4">
      {/* Three-stat row */}
      <div className="grid grid-cols-3 gap-2 w-full px-2">
        <div className="text-center">
          <p className="text-micro text-ink-muted uppercase tracking-wide">GBT</p>
          <p className="text-display-md repps-gradient-text tabular-nums leading-tight mt-0.5">
            {formatNumber(animatedCount)}
          </p>
          <p className="text-micro text-ink-secondary mt-0.5">burpees</p>
        </div>
        <div className="text-center">
          <p className="text-micro text-ink-muted uppercase tracking-wide">TARGET</p>
          <p className="text-display-md text-ink-primary tabular-nums leading-tight mt-0.5">
            {formatNumber(MILESTONE_TARGET)}
          </p>
          <p className="text-micro text-ink-secondary mt-0.5">by May 31</p>
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

      {teamMembers.length > 0 && (
        <div className="w-full px-4 mt-3">
          <div className="flex items-center justify-between bg-bg-surface rounded-lg px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-micro text-ink-muted uppercase tracking-wide">Team today</span>
              <span className="text-caption text-accent font-bold tabular-nums">
                {teamMembers.reduce((sum, m) => sum + m.todayCount, 0)} reps
              </span>
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
              src="/DAB-Repps-Mascot.png"
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
