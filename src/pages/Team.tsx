import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

export default function Team() {
  const { profile, refreshProfile } = useAuth();
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Teams</p>
        <p className="text-body text-ink-secondary text-center">
          Sign in to create or join a team
        </p>
      </div>
    );
  }

  // TODO: Phase 9 will build out team detail page, invite flow, join route, leave flow
  // For now: create team form if user has no team, or simple team info if they do

  if (profile.team_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Your Team</p>
        <p className="text-body text-ink-secondary text-center">
          Team detail page coming in Phase 9
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    const trimmed = teamName.trim();
    if (trimmed.length < 3 || trimmed.length > 24) {
      setError("Team name must be 3–24 characters");
      return;
    }
    setCreating(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("create_team", { p_name: trimmed });
    if (rpcError) {
      setError(rpcError.message);
      setCreating(false);
      return;
    }
    if (data && !data.success) {
      setError(data.error === "already_on_team" ? "You're already on a team" : data.message || data.error);
      setCreating(false);
      return;
    }
    await refreshProfile();
    setCreating(false);
  };

  return (
    <div className="flex flex-col items-center pt-8 px-4">
      <p className="text-headline text-ink-primary mb-1">Create a Team</p>
      <p className="text-body text-ink-secondary text-center mb-6">
        Teams of 3 unlock multipliers on your Rep Score
      </p>

      <div className="w-full max-w-sm flex flex-col gap-3">
        <input
          type="text"
          placeholder="Team name (3–24 characters)"
          value={teamName}
          onChange={(e) => { setTeamName(e.target.value); setError(""); }}
          maxLength={24}
          autoFocus
          className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Team"}
        </button>
      </div>
    </div>
  );
}
