import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import GoogleIcon from "../components/GoogleIcon";
import ModeIcon from "../components/ModeIcon";

interface EventPreview {
  id: string;
  name: string;
  description: string | null;
  banner_url: string | null;
  competition_mode: string;
  target_reps: number | null;
  max_participants: number | null;
  max_teams: number | null;
  status: string;
  starts_at: string;
  ends_at: string;
  participant_count: number;
  team_count: number;
}

const MODE_LABELS: Record<string, string> = {
  global_target: "Global Target",
  individual_most: "Most Reps",
  individual_target: "Individual Target",
  team_most: "Team Most",
  team_target: "Team Target",
  team_vs_team: "Team vs Team",
  live_sprint: "Live Sprint",
};

export default function EventJoin() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [event, setEvent] = useState<EventPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [isParticipant, setIsParticipant] = useState(false);

  const fetchEvent = useCallback(async () => {
    if (!code) {
      setError("No join code provided");
      setLoading(false);
      return;
    }

    const { data: eventData } = await supabase
      .from("events")
      .select("*")
      .eq("join_code", code.toUpperCase())
      .single();

    if (!eventData) {
      setError("Event not found");
      setLoading(false);
      return;
    }

    const { data: progressData } = await supabase.rpc("get_event_progress", {
      p_event_id: eventData.id,
    });

    setEvent({
      id: eventData.id,
      name: eventData.name,
      description: eventData.description,
      banner_url: eventData.banner_url,
      competition_mode: eventData.competition_mode,
      target_reps: eventData.target_reps,
      max_participants: eventData.max_participants,
      max_teams: eventData.max_teams,
      status: eventData.status,
      starts_at: eventData.starts_at,
      ends_at: eventData.ends_at,
      participant_count: progressData?.participant_count ?? 0,
      team_count: progressData?.team_count ?? 0,
    });

    if (profile) {
      const { data: participation } = await supabase
        .from("event_participants")
        .select("id")
        .eq("event_id", eventData.id)
        .eq("user_id", profile.id)
        .eq("status", "active")
        .maybeSingle();
      setIsParticipant(!!participation);
    }

    setLoading(false);
  }, [code, profile]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Auto-join after auth: if user lands on this page signed in and hasn't joined yet
  useEffect(() => {
    const pendingJoin = sessionStorage.getItem("pending_event_join");
    if (pendingJoin && profile && event && !isParticipant && !joining) {
      sessionStorage.removeItem("pending_event_join");
      handleJoin();
    }
  }, [profile, event, isParticipant]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async () => {
    if (!code || !event) return;
    setJoining(true);
    setError("");

    const { data, error: rpcError } = await supabase.rpc("join_event", {
      p_join_code: code.toUpperCase(),
    });

    if (rpcError) {
      setError(rpcError.message);
      setJoining(false);
      return;
    }
    if (!data?.success) {
      const msgs: Record<string, string> = {
        event_not_found: "Event not found",
        event_full: "This event is full",
        already_joined: "You're already in this event",
        not_joinable: "This event is not accepting new participants",
        no_active_team: "You need an active team to join this team event",
      };
      setError(msgs[data?.error] || data?.error || "Failed to join");
      setJoining(false);
      return;
    }

    navigate(`/events/${event.id}`, { replace: true });
  };

  const handleSignIn = async () => {
    sessionStorage.setItem("pending_event_join", code || "");
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Event Not Found</p>
        <p className="text-body text-ink-secondary text-center mb-6">
          {error || "This join link is invalid or the event no longer exists."}
        </p>
        <button
          onClick={() => navigate("/events", { replace: true })}
          className="py-3 px-8 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body transition-all duration-200 ease-apple active:scale-95"
        >
          Browse Events
        </button>
      </div>
    );
  }

  const isTeamMode = event.competition_mode.startsWith("team");
  const isCompleted = event.status === "completed" || event.status === "archived";
  const isFull = !isTeamMode
    ? (event.max_participants && event.participant_count >= event.max_participants)
    : (event.max_teams && event.team_count >= event.max_teams);
  const canJoin = !isParticipant && !isCompleted && !isFull && (event.status === "announced" || event.status === "active");

  return (
    <div className="flex flex-col items-center pt-4 px-4">
      {/* Banner */}
      {event.banner_url && (
        <img
          src={event.banner_url}
          alt=""
          className="w-full h-40 object-cover rounded-lg mb-4"
        />
      )}

      {/* Event info */}
      <p className="text-headline text-ink-primary text-center">{event.name}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <ModeIcon mode={event.competition_mode} />
        <span className="text-caption text-accent font-bold">
          {MODE_LABELS[event.competition_mode]}
        </span>
        {event.target_reps && (
          <span className="text-caption text-ink-muted">· {event.target_reps.toLocaleString("en-US")} repps</span>
        )}
      </div>
      <p className="text-caption text-ink-muted mt-1.5">
        {isTeamMode
          ? `${event.team_count} team${event.team_count !== 1 ? "s" : ""} joined`
          : `${event.participant_count} participant${event.participant_count !== 1 ? "s" : ""} joined`}
      </p>

      {event.description && (
        <p className="text-body text-ink-secondary text-center mt-3 max-w-sm">{event.description}</p>
      )}

      {/* Action area */}
      <div className="w-full max-w-sm mt-6 flex flex-col gap-3">
        {error && <p className="text-caption text-error text-center">{error}</p>}

        {!profile ? (
          <>
            <p className="text-body text-ink-primary text-center font-semibold mb-2">
              Sign in to join this event
            </p>
            <button
              onClick={handleSignIn}
              className="w-full py-4 px-6 rounded-pill bg-ink-primary text-ink-inverse font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <button
              onClick={() => navigate("/profile")}
              className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              Sign in with Email
            </button>
          </>
        ) : isParticipant ? (
          <>
            <p className="text-body text-success text-center font-semibold">
              You're already in this event!
            </p>
            <button
              onClick={() => navigate(`/events/${event.id}`, { replace: true })}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              View Event
            </button>
          </>
        ) : isCompleted ? (
          <>
            <p className="text-body text-ink-muted text-center">This event has ended.</p>
            <button
              onClick={() => navigate(`/events/${event.id}`, { replace: true })}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              View Results
            </button>
          </>
        ) : isFull ? (
          <>
            <p className="text-body text-ink-muted text-center">This event is full.</p>
            <button
              onClick={() => navigate("/events", { replace: true })}
              className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              Browse Events
            </button>
          </>
        ) : canJoin ? (
          <>
            {isTeamMode && !profile.team_id && (
              <p className="text-caption text-error text-center">
                You need an active team to join this team event
              </p>
            )}
            <button
              onClick={handleJoin}
              disabled={joining || (isTeamMode && !profile.team_id)}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {joining ? "Joining..." : "Join This Event"}
            </button>
          </>
        ) : (
          <>
            <p className="text-body text-ink-muted text-center">This event is not accepting participants right now.</p>
            <button
              onClick={() => navigate("/events", { replace: true })}
              className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              Browse Events
            </button>
          </>
        )}
      </div>
    </div>
  );
}
