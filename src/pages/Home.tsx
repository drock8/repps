import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import ActivityFeed from "../components/ActivityFeed";
import YouTubeEmbed from "../components/YouTubeEmbed";

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

interface Settings {
  globalTarget: number;
  targetLabel: string;
  targetDate: string | null;
}

// Persist last-known values so remounts never flash "0"
let cachedCount: number | null = null;
let cachedSettings: Settings | null = null;

export default function Home() {
  const { profile, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [totalReps, setTotalReps] = useState(cachedCount ?? 0);
  const [settings, setSettings] = useState<Settings | null>(cachedSettings);
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
        const [countResult, settingsResult] = await Promise.all([
          supabase.from("reps").select("*", { count: "exact", head: true }),
          supabase.from("settings").select("key, value").in("key", ["global_target", "target_label", "target_date"]),
        ]);

        if (!mountedRef.current) return;

        if (countResult.count !== null) {
          cachedCount = countResult.count;
          setTotalReps(countResult.count);
        }

        if (settingsResult.data && settingsResult.data.length > 0) {
          const map = Object.fromEntries(settingsResult.data.map((r) => [r.key, r.value]));
          const s: Settings = {
            globalTarget: parseInt(map.global_target, 10) || 100,
            targetLabel: map.target_label || "",
            targetDate: map.target_date || null,
          };
          cachedSettings = s;
          setSettings(s);
        }

        if (countResult.error || settingsResult.error) {
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

  useEffect(() => {
    const channel = supabase
      .channel("home-reps")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        () => {
          setTotalReps((prev) => {
            const next = prev + 1;
            cachedCount = next;
            return next;
          });
        }
      )
      .subscribe((status) => {
        // If subscription drops and reconnects, refetch to catch missed events
        if (status === "SUBSCRIBED") {
          supabase.from("reps").select("*", { count: "exact", head: true }).then(({ count }) => {
            if (count !== null && mountedRef.current) {
              cachedCount = count;
              setTotalReps(count);
            }
          });
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const percentage = settings
    ? Math.min((totalReps / settings.globalTarget) * 100, 100)
    : 0;

  return (
    <div className="flex flex-col items-center text-center h-full pt-4">
      <p className="text-headline text-ink-primary">GBT</p>
      <p className="text-display-xl repps-gradient-text mt-0.5 tabular-nums">
        {formatNumber(animatedCount)}
      </p>
      <p className="text-micro text-ink-secondary uppercase tracking-wide mt-0.5">
        Global Burpee Total
      </p>

      {settings && (
        <>
          <p className="text-caption text-ink-muted mt-1">
            {settings.targetLabel}
          </p>
          <div className="w-full max-w-xs mt-2">
            <div className="h-1 bg-bg-input rounded-pill overflow-hidden">
              <div
                className="h-full bg-accent rounded-pill transition-all duration-600 ease-apple"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="text-caption text-ink-muted mt-1">
              {percentage.toFixed(1)}%
            </p>
            {settings.targetDate && (
              <p className="text-caption text-ink-primary mt-0.5">
                {formatCountdown(settings.targetDate)}
              </p>
            )}
          </div>
        </>
      )}

      <div className="mt-3 w-full">
        <ActivityFeed />
      </div>

      <div className="mt-2 flex flex-col items-center">
        {profile ? (
          <div className="flex flex-col items-center">
            <button
              onClick={() => navigate("/dab")}
              className="w-[9.5rem] h-[9.5rem] rounded-full bg-accent text-ink-inverse font-extrabold italic text-[28px] flex items-center justify-center text-center leading-[1.1] transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(var(--color-accent-glow-secondary),0.4)]"
            >
              DAB<br />NOW
            </button>
            <p className="text-caption text-ink-muted mt-2">Drop a Burpee</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <button
              onClick={signInWithGoogle}
              className="w-[9.5rem] h-[9.5rem] rounded-full bg-accent text-ink-inverse font-extrabold italic text-[44px] flex items-center justify-center text-center leading-[1.1] transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(var(--color-accent-glow-secondary),0.4)]"
            >
              LFG!
            </button>
            <button
              onClick={signInWithGoogle}
              className="mt-3 text-caption text-ink-secondary"
            >
              Already have an account? Sign in
            </button>
          </div>
        )}
      </div>

      <div className="mt-auto pt-3 w-full">
        <YouTubeEmbed videoId="pZpr_WPCzf4" />
      </div>
    </div>
  );
}
