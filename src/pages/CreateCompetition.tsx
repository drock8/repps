import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

const DURATIONS = [
  { label: "2 min", value: 120 },
  { label: "3 min", value: 180 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
];

const TEAM_SIZES = [
  { label: "Solo", value: 1 },
  { label: "Duos", value: 2 },
  { label: "Trios", value: 3 },
  { label: "Quads", value: 4 },
  { label: "Fives", value: 5 },
];

export default function CreateCompetition() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(300);
  const [teamSize, setTeamSize] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!profile) return;
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setError("Name must be at least 3 characters");
      return;
    }
    setSubmitting(true);
    setError("");

    const { data, error: rpcError } = await supabase.rpc("create_competition", {
      p_name: trimmed,
      p_duration_seconds: duration,
      p_team_size: teamSize,
    });

    if (rpcError || !data?.success) {
      setError(rpcError?.message || data?.error || "Failed to create competition");
      setSubmitting(false);
      return;
    }

    navigate(`/live/${data.competition_id}`);
  }

  return (
    <div className="px-5 pt-6 pb-28 max-w-md mx-auto">
      <h1 className="text-display-md text-ink-primary mb-1">Create Competition</h1>
      <p className="text-body text-ink-secondary mb-8">
        Set up a live competition. Participants join via QR code.
      </p>

      <label className="block text-caption text-ink-secondary uppercase tracking-wider mb-2">
        Competition Name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Saturday Showdown"
        maxLength={60}
        className="w-full bg-bg-input text-ink-primary text-body-lg rounded-md px-4 py-3 mb-6 outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-muted"
      />

      <label className="block text-caption text-ink-secondary uppercase tracking-wider mb-3">
        Duration
      </label>
      <div className="flex gap-2 mb-6">
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            onClick={() => setDuration(d.value)}
            className={`flex-1 py-3 rounded-md text-body font-semibold transition-colors ${
              duration === d.value
                ? "bg-accent text-ink-inverse"
                : "bg-bg-surface text-ink-secondary"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <label className="block text-caption text-ink-secondary uppercase tracking-wider mb-3">
        Team Size
      </label>
      <div className="flex gap-2 mb-8">
        {TEAM_SIZES.map((t) => (
          <button
            key={t.value}
            onClick={() => setTeamSize(t.value)}
            className={`flex-1 py-3 rounded-md text-body font-semibold transition-colors ${
              teamSize === t.value
                ? "bg-accent text-ink-inverse"
                : "bg-bg-surface text-ink-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-error text-caption mb-4">{error}</p>
      )}

      <button
        onClick={handleCreate}
        disabled={submitting || name.trim().length < 3}
        className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold disabled:opacity-40 transition-opacity"
      >
        {submitting ? "Creating…" : "Create Competition"}
      </button>
    </div>
  );
}
