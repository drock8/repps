import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import ProfileGate from "../components/ProfileGate";

interface CompInfo {
  id: string;
  name: string;
  state: string;
  team_size: number;
  duration_seconds: number | null;
  target_type: string;
  join_code: string;
  participant_count: number;
}

export default function CompetitionJoin() {
  const { joinCode } = useParams<{ joinCode: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [comp, setComp] = useState<CompInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [teamName, setTeamName] = useState("");
  const [entryType, setEntryType] = useState<"individual" | "new_team">("individual");
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [showProfileGate, setShowProfileGate] = useState(false);

  useEffect(() => {
    if (!joinCode) return;
    loadCompetition();
  }, [joinCode]);

  async function loadCompetition() {
    setLoading(true);
    const { data: compData } = await supabase
      .from("competition_settings")
      .select("id, name, state, team_size, duration_seconds, target_type, join_code")
      .eq("join_code", joinCode!.toUpperCase())
      .single();

    if (!compData) {
      setError("Competition not found");
      setLoading(false);
      return;
    }

    const { count } = await supabase
      .from("competition_participants")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", compData.id)
      .neq("status", "withdrawn");

    if (profile) {
      const { data: existing } = await supabase
        .from("competition_participants")
        .select("id")
        .eq("competition_id", compData.id)
        .eq("user_id", profile.id)
        .neq("status", "withdrawn")
        .maybeSingle();
      if (existing) setAlreadyJoined(true);
    }

    setComp({ ...compData, participant_count: count || 0 });
    if (compData.team_size > 1) setEntryType("new_team");
    setLoading(false);
  }

  function handleJoinClick() {
    if (!profile || !comp) return;
    const needsProfile = !profile.dob || !profile.nationality_code;
    if (needsProfile) {
      setShowProfileGate(true);
      return;
    }
    doJoin();
  }

  async function doJoin() {
    if (!profile || !comp) return;
    setJoining(true);
    setError("");

    const { data, error: rpcErr } = await supabase.rpc("enter_competition", {
      p_join_code: comp.join_code,
      p_entry_type: entryType,
      p_team_name: entryType === "new_team" ? teamName.trim() || null : null,
    });

    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.message || data?.error || "Failed to join");
      setJoining(false);
      return;
    }

    navigate(`/live/${comp.id}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!comp) {
    return (
      <div className="px-5 pt-6 max-w-md mx-auto text-center">
        <p className="text-ink-secondary text-body-lg">{error || "Competition not found"}</p>
        <button
          onClick={() => navigate("/events")}
          className="mt-4 text-accent text-body font-semibold"
        >
          Browse Events
        </button>
      </div>
    );
  }

  const joinable = comp.state === "join_open" || comp.state === "join_closed";
  const durationLabel = comp.duration_seconds
    ? comp.duration_seconds >= 60
      ? `${Math.floor(comp.duration_seconds / 60)} min`
      : `${comp.duration_seconds}s`
    : "Target-based";

  return (
    <div className="px-5 pt-6 pb-28 max-w-md mx-auto">
      <div className="text-center mb-8">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-2">{comp.name}</h1>
        <div className="flex items-center justify-center gap-4 text-body text-ink-secondary">
          <span>{durationLabel}</span>
          <span>·</span>
          <span>{comp.team_size === 1 ? "Individual" : `Teams of ${comp.team_size}`}</span>
          <span>·</span>
          <span>{comp.participant_count} joined</span>
        </div>
      </div>

      {alreadyJoined ? (
        <div className="text-center">
          <p className="text-body-lg text-ink-primary mb-4">You're in! Get ready to compete.</p>
          <button
            onClick={() => navigate(`/dab?comp=${comp.id}`)}
            className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3"
          >
            Start Reps
          </button>
          <button
            onClick={() => navigate(`/live/${comp.id}`)}
            className="w-full py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold"
          >
            Watch Dashboard
          </button>
        </div>
      ) : !joinable ? (
        <div className="text-center">
          <p className="text-body text-ink-secondary mb-4">
            {comp.state === "draft" || comp.state === "announced"
              ? "Entries aren't open yet. Watch the big screen!"
              : "This competition is underway."}
          </p>
          <button
            onClick={() => navigate(`/live/${comp.id}`)}
            className="w-full py-4 rounded-lg bg-bg-surface text-ink-primary text-body-lg font-semibold"
          >
            Watch Live
          </button>
        </div>
      ) : (
        <>
          {comp.team_size > 1 && (
            <div className="mb-6">
              <label className="block text-caption text-ink-secondary uppercase tracking-wider mb-3">
                How do you want to enter?
              </label>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setEntryType("individual")}
                  className={`flex-1 py-3 rounded-md text-body font-semibold transition-colors ${
                    entryType === "individual"
                      ? "bg-accent text-ink-inverse"
                      : "bg-bg-surface text-ink-secondary"
                  }`}
                >
                  Solo
                </button>
                <button
                  onClick={() => setEntryType("new_team")}
                  className={`flex-1 py-3 rounded-md text-body font-semibold transition-colors ${
                    entryType === "new_team"
                      ? "bg-accent text-ink-inverse"
                      : "bg-bg-surface text-ink-secondary"
                  }`}
                >
                  Create Team
                </button>
              </div>
              {entryType === "new_team" && (
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team name"
                  maxLength={24}
                  className="w-full bg-bg-input text-ink-primary text-body-lg rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-muted"
                />
              )}
            </div>
          )}

          {error && <p className="text-error text-caption mb-4">{error}</p>}

          <button
            onClick={handleJoinClick}
            disabled={joining || (entryType === "new_team" && teamName.trim().length < 2)}
            className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold disabled:opacity-40 transition-opacity"
          >
            {joining ? "Joining…" : "Join Competition"}
          </button>
        </>
      )}

      {showProfileGate && (
        <ProfileGate
          onComplete={() => {
            setShowProfileGate(false);
            doJoin();
          }}
          onSkip={() => {
            setShowProfileGate(false);
            doJoin();
          }}
        />
      )}
    </div>
  );
}
