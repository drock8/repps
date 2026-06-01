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
    <div className="h-[100dvh] bg-bg-base text-ink-primary flex flex-col relative overflow-hidden">
      {/* Scrolling ticker — flush to top */}
      <div className="w-full overflow-hidden bg-bg-surface border-b border-divider py-1.5 flex-shrink-0">
        <div className="landing-ticker flex whitespace-nowrap">
          {TICKER_ITEMS.map((item, i) => (
            <span key={i} className="text-micro text-ink-secondary uppercase tracking-[0.15em] mx-6 flex items-center gap-3">
              {item}
              <span className="text-accent">&#x25C6;</span>
            </span>
          ))}
        </div>
      </div>

      {/* Main content — fills remaining space, distributed vertically */}
      <div className="flex-1 min-h-0 flex flex-col items-center text-center px-5 w-full max-w-md mx-auto justify-between py-[3vh]">
        <div className="flex flex-col items-center gap-[1.5vh]">
          {/* Logo */}
          <img src="/Repps-Blue-Logo.png" alt="REPPs" className="h-7" />

          {/* HQ badge */}
          <p className="text-micro text-ink-muted uppercase tracking-[0.15em]">
            Global Movement HQ
          </p>

          {/* Mission label */}
          <p className="text-micro text-accent uppercase tracking-[0.15em] font-bold">
            The Mission
          </p>

          {/* Headline */}
          <h1 className="landing-headline text-ink-primary font-bold leading-tight tracking-tight">
            Let's Get 1 Million<br />Moving for Good.
          </h1>

          {/* Live global counter */}
          <div>
            <p className="text-micro text-ink-muted uppercase tracking-wide">Global Burpees</p>
            <p className="landing-counter repps-gradient-text tabular-nums leading-none mt-0.5">
              {formatNumber(animatedCount)}
            </p>
          </div>

          {/* Video */}
          <div className="w-4/5 max-h-[22vh]">
            <VideoPlayer videoId="pZpr_WPCzf4" />
          </div>
        </div>

        {/* CTA — sits above bottom with sufficient padding */}
        <div className="w-full flex flex-col items-center flex-shrink-0">
          <button
            onClick={() => navigate("/home")}
            className="w-full py-4 px-8 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            Join the Movement
          </button>
          <p className="mt-2 text-micro text-ink-muted">No sign-up required</p>
        </div>
      </div>
      <ActivityFeed />
    </div>
  );
}

function VideoPlayer({ videoId }: { videoId: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="relative w-full rounded-xl overflow-hidden aspect-video max-h-full bg-black">
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
      className="relative w-full rounded-xl overflow-hidden aspect-video max-h-full bg-bg-surface group border border-divider"
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
