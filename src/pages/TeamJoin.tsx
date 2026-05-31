import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

const GOOGLE_ICON = (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

interface TeamPreview {
  id: string;
  name: string;
  status: string;
  members: { id: string; name: string; avatar_url: string | null }[];
}

export default function TeamJoin() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const [team, setTeam] = useState<TeamPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    async function fetchTeam() {
      if (!code) {
        setError("No join code provided");
        setLoading(false);
        return;
      }

      const { data: teamData } = await supabase
        .from("teams")
        .select("id, name, status")
        .eq("join_code", code.toUpperCase())
        .single();

      if (!teamData) {
        setError("Team not found");
        setLoading(false);
        return;
      }

      const { data: memberData } = await supabase
        .from("profiles")
        .select("id, name, avatar_url")
        .eq("team_id", teamData.id);

      setTeam({
        ...teamData,
        members: memberData || [],
      });
      setLoading(false);
    }

    fetchTeam();
  }, [code]);

  const handleJoin = async () => {
    if (!code) return;
    setJoining(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("join_team", { p_join_code: code.toUpperCase() });
    if (rpcError) {
      setError(rpcError.message);
      setJoining(false);
      return;
    }
    if (data && !data.success) {
      const msgs: Record<string, string> = {
        team_not_found: "Team not found",
        team_full: "This team is already full (3/3)",
        already_on_team: "You're already on a team. Leave your current team first.",
        team_disbanded: "This team has been disbanded",
      };
      setError(msgs[data.error] || data.message || data.error);
      setJoining(false);
      return;
    }
    await refreshProfile();
    navigate("/team", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Team Not Found</p>
        <p className="text-body text-ink-secondary text-center mb-6">
          {error || "This join link is invalid or the team no longer exists."}
        </p>
        <button
          onClick={() => navigate("/team", { replace: true })}
          className="py-3 px-8 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body transition-all duration-200 ease-apple active:scale-95"
        >
          Go to Teams
        </button>
      </div>
    );
  }

  const isFull = team.members.length >= 3;
  const alreadyOnThisTeam = profile?.team_id === team.id;
  const alreadyOnAnotherTeam = profile?.team_id && profile.team_id !== team.id;

  return (
    <div className="flex flex-col items-center pt-8 px-4">
      <p className="text-headline text-ink-primary mb-1">Join Team</p>
      <p className="text-display-md text-accent mt-2 mb-6">{team.name}</p>

      {/* Members preview */}
      <div className="w-full max-w-sm bg-bg-surface rounded-lg p-4 mb-6">
        <p className="text-micro text-ink-muted uppercase tracking-wide mb-3">
          {team.members.length}/3 Members
        </p>
        <div className="flex flex-col gap-3">
          {team.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              {m.avatar_url ? (
                <img
                  src={m.avatar_url}
                  alt={m.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-caption font-bold text-ink-inverse">
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <p className="text-body text-ink-primary">{m.name}</p>
            </div>
          ))}
          {Array.from({ length: 3 - team.members.length }).map((_, i) => (
            <div key={`slot-${i}`} className="flex items-center gap-3 opacity-40">
              <div className="w-8 h-8 rounded-full bg-bg-elevated" />
              <p className="text-body text-ink-muted">Open spot</p>
            </div>
          ))}
        </div>
      </div>

      {!profile ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-body text-ink-secondary text-center mb-2">
            Sign in to join this team
          </p>
          <button
            onClick={async () => {
              const redirectTo = window.location.href;
              const { data } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                  redirectTo,
                  queryParams: { prompt: "select_account" },
                  skipBrowserRedirect: true,
                },
              });
              if (data?.url) window.location.href = data.url;
            }}
            className="w-full py-4 rounded-pill bg-white border border-ink-border flex items-center justify-center gap-3 font-semibold text-body-lg text-ink-primary transition-all duration-200 ease-apple active:scale-95"
          >
            {GOOGLE_ICON}
            Continue with Google
          </button>
          <button
            onClick={() => navigate("/profile")}
            className="w-full py-3 text-caption text-ink-muted text-center"
          >
            Sign in with Email
          </button>
        </div>
      ) : alreadyOnThisTeam ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-body text-success text-center font-semibold">You're already on this team</p>
          <button
            onClick={() => navigate("/team", { replace: true })}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            Go to Team
          </button>
        </div>
      ) : alreadyOnAnotherTeam ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-body text-ink-secondary text-center">
            You're already on a team. Leave your current team to join this one.
          </p>
          <button
            onClick={() => navigate("/team", { replace: true })}
            className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            Go to Your Team
          </button>
        </div>
      ) : isFull ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-body text-ink-secondary text-center">This team is already full (3/3)</p>
          <button
            onClick={() => navigate("/team", { replace: true })}
            className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            Create Your Own Team
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-3">
          {error && <p className="text-caption text-error text-center">{error}</p>}
          <button
            onClick={handleJoin}
            disabled={joining}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
          >
            {joining ? "Joining..." : "Join This Team"}
          </button>
          <button
            onClick={() => navigate("/team", { replace: true })}
            className="w-full py-3 text-caption text-ink-muted text-center"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
