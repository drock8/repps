import { useAuth } from "../contexts/AuthContext";

export default function Home() {
  const { profile, signInWithGoogle } = useAuth();

  return (
    <div className="flex flex-col items-center text-center pt-12">
      <p className="text-micro text-ink-secondary uppercase tracking-wide">
        🌍 Total Global Burpees
      </p>
      <p className="text-display-xl text-ink-primary mt-2 tabular-nums">0</p>
      <p className="text-caption text-ink-muted mt-2">
        target: 100 by May 25, 2026
      </p>

      <div className="w-full max-w-xs mt-4">
        <div className="h-1 bg-bg-input rounded-pill overflow-hidden">
          <div className="h-full bg-accent rounded-pill" style={{ width: "0%" }} />
        </div>
      </div>

      <div className="mt-16 text-caption text-ink-muted">
        (Live feed coming in Phase D)
      </div>

      <div className="mt-16 w-full max-w-sm">
        {profile ? (
          <button
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
