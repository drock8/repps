import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useRepsChannel } from "../hooks/useRepsChannel";
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
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const value = Math.round(from + diff * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        currentRef.current = target;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return display;
}

const TICKER_ITEMS = [
  "CV-VERIFIED",
  "TRIBAL COMPETITION",
  "GLOBAL COUNTER",
  "CV-VERIFIED",
  "TRIBAL COMPETITION",
  "GLOBAL COUNTER",
];

let cachedLandingCount: number | null = null;

export default function Landing() {
  const navigate = useNavigate();
  const [totalReps, setTotalReps] = useState(cachedLandingCount ?? 0);
  const animatedCount = useAnimatedCounter(totalReps);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    async function fetchCount() {
      const { count } = await supabase
        .from("reps")
        .select("*", { count: "exact", head: true });
      if (count !== null && mountedRef.current) {
        cachedLandingCount = count;
        setTotalReps(count);
      }
    }
    fetchCount();
  }, []);

  useRepsChannel((payload) => {
    void payload;
    setTotalReps((prev) => {
      const next = prev + 1;
      cachedLandingCount = next;
      return next;
    });
  });

  return (
    <div className="min-h-screen bg-bg-base text-ink-primary flex flex-col items-center relative overflow-hidden">
      <ActivityFeed />

      {/* Scrolling ticker */}
      <div className="w-full overflow-hidden bg-bg-surface border-b border-divider py-2">
        <div className="landing-ticker flex whitespace-nowrap">
          {TICKER_ITEMS.map((item, i) => (
            <span key={i} className="text-micro text-ink-secondary uppercase tracking-[0.15em] mx-6 flex items-center gap-3">
              {item}
              <span className="text-accent">&#x25C6;</span>
            </span>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col items-center text-center px-4 pt-10 pb-16 w-full max-w-md">
        {/* Logo */}
        <img src="/Repps-Blue-Logo.png" alt="REPPs" className="h-8" />

        {/* HQ badge */}
        <p className="mt-6 text-micro text-ink-muted uppercase tracking-[0.15em]">
          Global Movement HQ
        </p>

        {/* Mission label */}
        <p className="mt-5 text-micro text-accent uppercase tracking-[0.15em] font-bold">
          The Mission
        </p>

        {/* Headline */}
        <h1 className="mt-3 text-display-md text-ink-primary font-bold leading-tight tracking-tight">
          Let's Get 1 Million<br />Moving for Good.
        </h1>

        {/* Live global counter */}
        <div className="mt-8">
          <p className="text-micro text-ink-muted uppercase tracking-wide">Global Burpees</p>
          <p className="text-display-xl repps-gradient-text tabular-nums leading-none mt-1">
            {formatNumber(animatedCount)}
          </p>
        </div>

        {/* Video — clean card, no busy thumbnail */}
        <div className="mt-8 w-4/5">
          <VideoPlayer videoId="pZpr_WPCzf4" />
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate("/home")}
          className="mt-8 w-full py-4 px-8 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
        >
          Join the Movement
        </button>

        <p className="mt-3 text-micro text-ink-muted">No sign-up required</p>
      </div>
    </div>
  );
}

function VideoPlayer({ videoId }: { videoId: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="relative w-full rounded-xl overflow-hidden aspect-video bg-black">
        <iframe
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=1`}
          title="REPPs mission"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="relative w-full rounded-xl overflow-hidden aspect-video bg-bg-surface group border border-divider"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center transition-transform duration-200 group-active:scale-90">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 ml-0.5 text-accent">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="text-caption text-ink-secondary">Watch the Mission</span>
      </div>
    </button>
  );
}
