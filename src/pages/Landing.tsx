import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/format";
import { useRepsChannel } from "../hooks/useRepsChannel";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { useTheme } from "../contexts/ThemeContext";
import ActivityFeed from "../components/ActivityFeed";
import AuthForm from "../components/AuthForm";

const MISSION_HEADLINES = [
  { headline: "1 Million People.\n1 Burpee at a Time.", subtitle: "Micro-effort. Macro momentum." },
  { headline: "Let's Get 1 Million\nSouls Moving.", subtitle: "Not one hour. Every hour." },
  { headline: "Move a Little.\nAll Day. Every Day.", subtitle: "Join 1 million people\nproving consistency beats intensity." },
];

const TICKER_ITEMS = [
  "CV-VERIFIED",
  "TRIBAL COMPETITION",
  "GLOBAL COUNTER",
  "CV-VERIFIED",
  "TRIBAL COMPETITION",
  "GLOBAL COUNTER",
];

const MOTIVATIONAL_QUOTES = [
  "The body achieves what the mind believes.",
  "One rep at a time. One day at a time.",
  "You didn't come this far to only come this far.",
  "Small daily improvements lead to stunning results.",
  "The only bad workout is the one that didn't happen.",
  "Your future self will thank you.",
  "Movement is medicine.",
  "Discipline is choosing what you want most over what you want now.",
  "Every rep counts. Every day matters.",
  "Be stronger than your excuses.",
  "The hardest part is showing up. You're here.",
  "Progress, not perfection.",
  "Fall seven times, stand up eight.",
  "Champions are made when nobody is watching.",
  "Your only limit is you.",
  "Micro-effort. Macro momentum.",
  "1 rep beats 0. Every single time.",
  "Not one hour. Every hour.",
  "Your body doesn't need an hour. It needs right now.",
  "Move a little. All day. Every day.",
  "One rep changes nothing. One rep every day changes everything.",
  "Small reps. Big ripple.",
  "Exercise isn't a session. It's a habit.",
];

let cachedLandingCount: number | null = null;

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const theme = useTheme();
  const [totalReps, setTotalReps] = useState(cachedLandingCount ?? 0);
  const animatedCount = useAnimatedCounter(totalReps);
  const authParam = searchParams.get("auth");
  const [showAuth, setShowAuth] = useState<false | "choose" | "signin">(
    authParam === "signup" ? "choose" : false
  );
  const mountedRef = useRef(true);
  const quote = useMemo(() => MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)], []);
  const mission = useMemo(() => MISSION_HEADLINES[Math.floor(Math.random() * MISSION_HEADLINES.length)], []);
  const logo = theme === "blue" ? "/Repps-Blue-Logo.png"
    : theme === "yellow" ? "/Repps-Yellow-Logo.png"
    : "/repps-logo.png";

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

      {/* Main content — fills remaining space */}
      <div className="flex-1 min-h-0 flex flex-col items-center text-center px-5 w-full max-w-md mx-auto pt-[4vh]" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        {/* Logo + HQ badge + Sign In */}
        <div className="w-full flex flex-col items-center flex-shrink-0">
          <div className="w-full flex items-center justify-between">
            <div className="w-16" />
            <img src={logo} alt="REPPs" className="h-10" />
            {!showAuth ? (
              <button
                onClick={() => setShowAuth("signin")}
                className="w-16 text-caption font-semibold text-ink-secondary transition-colors duration-200 ease-apple active:text-accent"
              >
                Sign In
              </button>
            ) : (
              <div className="w-16" />
            )}
          </div>
          <p className="mt-1 text-micro text-ink-muted uppercase tracking-[0.15em]">
            Global Movement HQ
          </p>
        </div>

        {showAuth ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-body text-ink-secondary italic">"{quote}"</p>
            </div>
            <AuthForm initialMode={showAuth} onBack={() => setShowAuth(false)} />
            <a
              href="/about.html"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 text-caption text-ink-muted transition-colors duration-200 ease-apple active:text-accent"
            >
              About REPPs
            </a>
          </div>
        ) : (
          <>
            {/* Middle content — vertically centered in remaining space */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-[1.5vh]">
              <p className="text-micro text-accent uppercase tracking-[0.15em] font-bold">
                The Mission
              </p>

              <h1 className="landing-headline text-ink-primary font-bold leading-tight tracking-tight">
                {mission.headline.split("\n").map((line, i, arr) => (
                  <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                ))}
              </h1>

              <p className="text-body text-ink-secondary whitespace-pre-line">
                {mission.subtitle}
              </p>

              <div>
                <p className="text-micro text-ink-muted uppercase tracking-wide">Global Verified Burpees</p>
                <p className="landing-counter repps-gradient-text tabular-nums leading-none mt-0.5">
                  {formatNumber(animatedCount)}
                </p>
              </div>

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
              <a
                href="/about.html"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 text-caption text-ink-muted transition-colors duration-200 ease-apple active:text-accent"
              >
                About REPPs
              </a>
            </div>
          </>
        )}
      </div>
      <div className="absolute"><ActivityFeed /></div>
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
