import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import ActivityFeed from "../components/ActivityFeed";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
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
      // ease-apple: cubic-bezier(0.4, 0, 0.2, 1)
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
}

export default function Home() {
  const { profile, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [totalReps, setTotalReps] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const animatedCount = useAnimatedCounter(totalReps);

  const fetchInitialCount = useCallback(async () => {
    const { count } = await supabase
      .from("reps")
      .select("*", { count: "exact", head: true });
    if (count !== null) setTotalReps(count);
  }, []);

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["global_target", "target_label"]);
    if (data) {
      const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
      setSettings({
        globalTarget: parseInt(map.global_target, 10) || 100,
        targetLabel: map.target_label || "",
      });
    }
  }, []);

  useEffect(() => {
    fetchInitialCount();
    fetchSettings();
  }, [fetchInitialCount, fetchSettings]);

  useEffect(() => {
    const channel = supabase
      .channel("home-reps")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        () => {
          setTotalReps((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const percentage = settings
    ? Math.min((totalReps / settings.globalTarget) * 100, 100)
    : 0;

  return (
    <div className="flex flex-col items-center text-center pt-12">
      <p className="text-headline text-ink-primary">GBT</p>
      <p className="text-display-xl repps-gradient-text mt-1 tabular-nums">
        {formatNumber(animatedCount)}
      </p>
      <p className="text-micro text-ink-secondary uppercase tracking-wide mt-1">
        Global Burpee Total
      </p>

      {settings && (
        <>
          <p className="text-caption text-ink-muted mt-2">
            {settings.targetLabel}
          </p>
          <div className="w-full max-w-xs mt-4">
            <div className="h-1 bg-bg-input rounded-pill overflow-hidden">
              <div
                className="h-full bg-accent rounded-pill transition-all duration-600 ease-apple"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="text-caption text-ink-muted mt-1">
              {percentage.toFixed(1)}%
            </p>
          </div>
        </>
      )}

      <div className="mt-12 w-full">
        <ActivityFeed />
      </div>

      <div className="mt-16 w-full max-w-sm">
        {profile ? (
          <button
            onClick={() => navigate("/dab")}
            className="w-full bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(255,200,87,0.4)]"
          >
            DAB NOW ⚡
          </button>
        ) : (
          <>
            <button
              onClick={signInWithGoogle}
              className="w-full bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(255,200,87,0.4)]"
            >
              JOIN THE FUN
            </button>
            <button
              onClick={signInWithGoogle}
              className="mt-3 text-caption text-ink-secondary"
            >
              Already have an account? Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
