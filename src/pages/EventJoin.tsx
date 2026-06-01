import { useEffect, useState, useCallback } from "react";
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

function ModeIcon({ mode }: { mode: string }) {
  const isTeam = mode.startsWith("team");
  const isGlobal = mode === "global_target";
  const isSprint = mode === "live_sprint";

  if (isSprint) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2" />
        <path d="M5 3L2 6" />
        <path d="M22 6l-3-3" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="10" y1="1" x2="14" y2="1" />
      </svg>
    );
  }
  if (isGlobal) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }
  if (isTeam) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

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
          <span className="text-caption text-ink-muted">· {event.target_reps.toLocaleString("en-US")} reps</span>
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
              {GOOGLE_ICON}
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
