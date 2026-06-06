import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";
import { formatNumber, MEDALS } from "../lib/format";
import { formatTimeStatus } from "../lib/eventTime";
import { useAuth } from "../contexts/AuthContext";
import Avatar from "../components/Avatar";
import ModeIcon from "../components/ModeIcon";

type DetailTab = "leaderboard" | "details" | "qr";

interface SponsorData {
  name: string;
  logo_url: string | null;
  link_url: string | null;
}

interface EventData {
  id: string;
  name: string;
  description: string | null;
  banner_url: string | null;
  category: string;
  competition_mode: string;
  target_reps: number | null;
  scoring_method: string;
  visibility: string;
  join_code: string;
  prize_type: string;
  prize_description: string | null;
  max_participants: number | null;
  max_teams: number | null;
  allow_late_join: boolean;
  retroactive_reps: boolean;
  is_featured: boolean;
  starts_at: string;
  ends_at: string;
  status: string;
  created_by: string;
  created_at: string;
  location: string | null;
  sprint_duration_minutes: number | null;
  rules: string | null;
  sponsors: SponsorData[];
}

interface IndividualEntry {
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  total_reps: number;
  rank: number;
}

interface TeamEntry {
  team_id: string;
  team_name: string;
  total_reps: number;
  rank: number;
}

interface LeaderboardData {
  competition_mode: string;
  scoring_method: string;
  leaderboard: (IndividualEntry | TeamEntry)[];
  caller: { rank: number; total_reps: number } | null;
}

interface ProgressData {
  competition_mode: string;
  total_reps: number;
  target_reps?: number;
  percentage?: number;
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

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [event, setEvent] = useState<EventData | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("leaderboard");
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isParticipant, setIsParticipant] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Record<string, IndividualEntry[]>>({});
  const [creatorName, setCreatorName] = useState("");

  // QR
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [qrGenerated, setQrGenerated] = useState(false);

  // Organizer controls
  const [actionLoading, setActionLoading] = useState(false);

  // Competitions
  const [competitions, setCompetitions] = useState<{ id: string; name: string; state: string; join_code: string; duration_seconds: number | null; team_size: number }[]>([]);
  const [showCreateComp, setShowCreateComp] = useState(false);
  const [showCompList, setShowCompList] = useState(true);
  const [compName, setCompName] = useState("");
  const [compDuration, setCompDuration] = useState(300);
  const [compTeamSize, setCompTeamSize] = useState(1);
  const [compStyle, setCompStyle] = useState("standard");
  const [compCreating, setCompCreating] = useState(false);

  const fetchEvent = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const { data: eventData, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !eventData) {
      setLoading(false);
      return;
    }
    setEvent(eventData);

    // Fetch creator name
    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", eventData.created_by)
      .single();
    if (creatorProfile) setCreatorName(creatorProfile.name);

    // Check participation
    if (profile) {
      const { data: participation } = await supabase
        .from("event_participants")
        .select("id")
        .eq("event_id", id)
        .eq("user_id", profile.id)
        .eq("status", "active")
        .maybeSingle();
      setIsParticipant(!!participation);
    }

    // Fetch progress
    const { data: progressData } = await supabase.rpc("get_event_progress", {
      p_event_id: id,
    });
    if (progressData?.success) setProgress(progressData);

    // Fetch leaderboard
    const { data: lbData } = await supabase.rpc("get_event_leaderboard", {
      p_event_id: id,
      p_limit: 50,
    });
    if (lbData?.success) setLeaderboard(lbData);

    // Fetch competitions for this event
    const { data: compData } = await supabase
      .from("competition_settings")
      .select("id, name, state, join_code, duration_seconds, team_size")
      .eq("event_id", id)
      .order("created_at", { ascending: false });
    if (compData) setCompetitions(compData);

    // Auto-status transitions
    const now = Date.now();
    if (eventData.status === "announced" && new Date(eventData.starts_at).getTime() <= now) {
      await supabase.from("events").update({ status: "active" }).eq("id", id);
      setEvent((prev) => prev ? { ...prev, status: "active" } : prev);
    }
    if ((eventData.status === "active" || (eventData.status === "announced" && new Date(eventData.starts_at).getTime() <= now)) && new Date(eventData.ends_at).getTime() < now) {
      await supabase.rpc("complete_event", { p_event_id: id });
      setEvent((prev) => prev ? { ...prev, status: "completed" } : prev);
    }

    setLoading(false);
  }, [id, profile]);

  // Realtime subscription for participant changes
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event-participants-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_participants", filter: `event_id=eq.${id}` },
        () => { fetchEvent(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchEvent]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Generate QR code when tab switches
  useEffect(() => {
    if (activeTab === "qr" && event && qrCanvasRef.current && !qrGenerated) {
      const joinUrl = `${window.location.origin}/events/join/${event.join_code}`;
      QRCode.toCanvas(qrCanvasRef.current, joinUrl, {
        width: 256,
        margin: 2,
        color: { dark: "#F5F2EA", light: "#1C1F24" },
      }).then(() => setQrGenerated(true));
    }
  }, [activeTab, event, qrGenerated]);

  const handleJoin = async () => {
    if (!event || !profile) return;
    setJoining(true);
    const { data } = await supabase.rpc("join_event", { p_join_code: event.join_code });
    if (data?.success) {
      setIsParticipant(true);
      fetchEvent();
    }
    setJoining(false);
  };

  const handleLeave = async () => {
    if (!event) return;
    const { data } = await supabase.rpc("leave_event", { p_event_id: event.id });
    if (data?.success) {
      setIsParticipant(false);
      fetchEvent();
    }
  };

  const handleShare = async () => {
    if (!event) return;
    const url = `${window.location.origin}/events/join/${event.join_code}`;
    const desc = event.description ? ` ${event.description.slice(0, 100)}` : "";
    const text = `Join ${event.name} on REPPs!${desc} ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = async () => {
    if (!event) return;
    const url = `${window.location.origin}/events/join/${event.join_code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQR = () => {
    if (!qrCanvasRef.current || !event) return;
    const link = document.createElement("a");
    link.download = `${event.name.replace(/\s+/g, "-")}-QR.png`;
    link.href = qrCanvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handleAnnounce = async () => {
    if (!event) return;
    setActionLoading(true);
    await supabase.rpc("announce_event", { p_event_id: event.id });
    await fetchEvent();
    setActionLoading(false);
  };

  const handleComplete = async () => {
    if (!event) return;
    setActionLoading(true);
    await supabase.rpc("complete_event", { p_event_id: event.id });
    await fetchEvent();
    setActionLoading(false);
  };

  const handleFeature = async () => {
    if (!event) return;
    setActionLoading(true);
    await supabase.from("events").update({ is_featured: false }).eq("is_featured", true);
    await supabase.from("events").update({ is_featured: true }).eq("id", event.id);
    await fetchEvent();
    setActionLoading(false);
  };

  const handleUnfeature = async () => {
    if (!event) return;
    setActionLoading(true);
    await supabase.from("events").update({ is_featured: false }).eq("id", event.id);
    await fetchEvent();
    setActionLoading(false);
  };

  const handleDeleteDraft = async () => {
    if (!event) return;
    if (!window.confirm("Delete this draft event?")) return;
    setActionLoading(true);
    await supabase.from("event_participants").delete().eq("event_id", event.id);
    await supabase.from("events").delete().eq("id", event.id);
    setActionLoading(false);
    navigate("/events");
  };

  const handleArchive = async () => {
    if (!event) return;
    setActionLoading(true);
    await supabase.from("events").update({ status: "archived", is_featured: false }).eq("id", event.id);
    await fetchEvent();
    setActionLoading(false);
  };

  const handleCreateCompetition = async () => {
    if (!event) return;
    const trimmed = compName.trim() || event.name;
    setCompCreating(true);
    const winnerCategories = compStyle === "olympics"
      ? ["most_reps", "highest_avg"]
      : ["overall"];
    const { data } = await supabase.rpc("add_competition_to_event", {
      p_event_id: event.id,
      p_name: trimmed,
      p_duration_seconds: compDuration,
      p_team_size: compTeamSize,
      p_winner_categories: winnerCategories,
    });
    if (data?.success) {
      setShowCreateComp(false);
      setCompName("");
      await fetchEvent();
    }
    setCompCreating(false);
  };

  const fetchTeamMembers = async (teamId: string) => {
    if (teamMembers[teamId]) return;
    if (!event) return;

    const { data: members } = await supabase
      .from("event_participants")
      .select("user_id, joined_at")
      .eq("event_id", event.id)
      .eq("team_id", teamId)
      .eq("status", "active");

    if (!members) return;

    const memberEntries: IndividualEntry[] = [];
    for (const m of members) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", m.user_id)
        .single();

      const startDate = event.retroactive_reps ? event.starts_at : m.joined_at;
      const endDate = event.status === "completed" ? event.ends_at : new Date().toISOString();
      const { count } = await supabase
        .from("reps")
        .select("*", { count: "exact", head: true })
        .eq("user_id", m.user_id)
        .gte("validated_at", startDate)
        .lte("validated_at", endDate);

      memberEntries.push({
        user_id: m.user_id,
        user_name: profileData?.name || "Unknown",
        avatar_url: profileData?.avatar_url || null,
        total_reps: count || 0,
        rank: 0,
      });
    }

    memberEntries.sort((a, b) => b.total_reps - a.total_reps);
    setTeamMembers((prev) => ({ ...prev, [teamId]: memberEntries }));
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
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <p className="text-headline text-ink-primary mb-2">Event not found</p>
        <button onClick={() => navigate("/events")} className="text-caption text-accent">
          Back to Events
        </button>
      </div>
    );
  }

  const time = formatTimeStatus(event);
  const isTargetMode = ["global_target", "individual_target", "team_target"].includes(event.competition_mode);
  const isTeamMode = event.competition_mode.startsWith("team");
  const isOrganizer = profile?.id === event.created_by;
  const canJoin = !isParticipant && profile && (event.status === "announced" || (event.status === "active" && event.allow_late_join));
  const canLeave = isParticipant && ["announced", "active"].includes(event.status);

  const DETAIL_TABS: { label: string; value: DetailTab }[] = [
    { label: "Leaderboard", value: "leaderboard" },
    { label: "Details", value: "details" },
    { label: "QR Code", value: "qr" },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-4 pb-8">
      {/* Back button */}
      <button
        onClick={() => navigate("/events")}
        className="flex items-center gap-1 text-caption text-ink-secondary self-start -mb-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Events
      </button>

      {/* Banner */}
      {event.banner_url && (
        <img
          src={event.banner_url}
          alt=""
          className="w-full aspect-video object-cover rounded-lg"
        />
      )}

      {/* Event header */}
      <div>
        <p className="text-headline text-ink-primary">{event.name}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <ModeIcon mode={event.competition_mode} />
          <span className="text-caption text-accent font-bold">
            {MODE_LABELS[event.competition_mode]}
          </span>
          {isTargetMode && event.target_reps && (
            <span className="text-caption text-ink-muted">· {formatNumber(event.target_reps)} repps</span>
          )}
        </div>
        <p className={`text-caption mt-1 ${time.isLive ? "text-success font-semibold" : time.isCompleted ? "text-ink-muted" : "text-ink-secondary"}`}>
          {time.text}
        </p>

        {time.isCompleted && (
          <span className="inline-block mt-1.5 text-micro uppercase tracking-wide px-2 py-0.5 rounded-pill bg-ink-muted/20 text-ink-muted font-bold">
            Completed
          </span>
        )}
      </div>

      {/* Progress bar for target modes */}
      {isTargetMode && progress?.target_reps && (
        <div>
          <div className="h-2 bg-bg-input rounded-pill overflow-hidden">
            <div
              className="h-full bg-accent rounded-pill transition-all duration-300 ease-apple"
              style={{ width: `${Math.min(100, progress.percentage || 0)}%` }}
            />
          </div>
          <p className="text-caption text-ink-secondary mt-1">
            {formatNumber(progress.total_reps)} / {formatNumber(progress.target_reps)} repps · {Math.round(progress.percentage || 0)}%
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {canJoin && (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="flex-1 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
          >
            {joining ? "Joining..." : "Join Event"}
          </button>
        )}
        <button
          onClick={handleShare}
          className={`${canJoin ? "" : "flex-1"} py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95`}
        >
          {copied ? "Copied!" : "Share"}
        </button>
      </div>

      {canLeave && (
        <button
          onClick={handleLeave}
          className="text-caption text-ink-muted text-center"
        >
          Leave event
        </button>
      )}

      {/* Organizer controls */}
      {isOrganizer && (
        <div className="flex flex-wrap gap-2">
          {(event.status === "draft" || event.status === "announced") && (
            <button
              onClick={() => navigate(`/events/create?edit=${event.id}`)}
              className="py-2 px-4 rounded-pill bg-bg-elevated text-ink-primary text-caption font-semibold transition-all duration-200 ease-apple active:scale-95"
            >
              Edit
            </button>
          )}
          {event.status === "draft" && (
            <button
              onClick={handleAnnounce}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-success/20 text-success text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Announce
            </button>
          )}
          {["announced", "active"].includes(event.status) && (
            <button
              onClick={handleComplete}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-accent/20 text-accent text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Complete
            </button>
          )}
          {event.is_featured ? (
            <button
              onClick={handleUnfeature}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-accent-gold/20 text-accent-gold text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Featured
            </button>
          ) : event.category === "official" && ["announced", "active"].includes(event.status) && (
            <button
              onClick={handleFeature}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-ink-muted/20 text-ink-muted text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Feature
            </button>
          )}
          {event.status === "completed" && (
            <button
              onClick={handleArchive}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-ink-muted/20 text-ink-muted text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Archive
            </button>
          )}
          {event.status === "draft" && (
            <button
              onClick={handleDeleteDraft}
              disabled={actionLoading}
              className="py-2 px-4 rounded-pill bg-red-500/20 text-red-400 text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* Live Competitions */}
      {(competitions.length > 0 || isOrganizer) && (
        <div className="flex flex-col gap-3">
          <p className="text-micro text-ink-muted uppercase tracking-widest">Live Competitions</p>

          {isOrganizer && !showCreateComp && (
            <button
              onClick={() => setShowCreateComp(true)}
              className="w-full py-3 rounded-lg border border-dashed border-accent/40 text-accent text-body font-semibold active:scale-[0.98] transition-transform"
            >
              + Add Competition
            </button>
          )}

          {showCreateComp && (
            <div className="bg-bg-surface rounded-lg p-4 flex flex-col gap-4">
              <input
                type="text"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                placeholder={event?.name || "Competition name"}
                maxLength={60}
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-muted"
              />
              <div>
                <p className="text-micro text-ink-muted uppercase tracking-wider mb-2">Duration</p>
                <div className="flex gap-2">
                  {[{ l: "2m", v: 120 }, { l: "3m", v: 180 }, { l: "5m", v: 300 }, { l: "10m", v: 600 }].map((d) => (
                    <button
                      key={d.v}
                      onClick={() => setCompDuration(d.v)}
                      className={`flex-1 py-2 rounded-md text-caption font-semibold ${
                        compDuration === d.v ? "bg-accent text-ink-inverse" : "bg-bg-input text-ink-secondary"
                      }`}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-micro text-ink-muted uppercase tracking-wider mb-2">Team Size</p>
                <div className="flex gap-2">
                  {[{ l: "Solo", v: 1 }, { l: "Duo", v: 2 }, { l: "Trio", v: 3 }, { l: "Quad", v: 4 }].map((t) => (
                    <button
                      key={t.v}
                      onClick={() => setCompTeamSize(t.v)}
                      className={`flex-1 py-2 rounded-md text-caption font-semibold ${
                        compTeamSize === t.v ? "bg-accent text-ink-inverse" : "bg-bg-input text-ink-secondary"
                      }`}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-micro text-ink-muted uppercase tracking-wider mb-2">Style</p>
                <div className="flex gap-2">
                  {[{ l: "Standard", v: "standard" }, { l: "Olympics", v: "olympics" }].map((s) => (
                    <button
                      key={s.v}
                      onClick={() => setCompStyle(s.v)}
                      className={`flex-1 py-2 rounded-md text-caption font-semibold ${
                        compStyle === s.v ? "bg-accent text-ink-inverse" : "bg-bg-input text-ink-secondary"
                      }`}
                    >
                      {s.l}
                    </button>
                  ))}
                </div>
                {compStyle === "olympics" && (
                  <p className="text-[10px] text-ink-muted mt-1">Two podiums: most reps + highest avg by country</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreateComp(false)}
                  className="flex-1 py-3 rounded-md bg-bg-input text-ink-secondary text-body font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCompetition}
                  disabled={compCreating}
                  className="flex-1 py-3 rounded-md bg-accent text-ink-inverse text-body font-semibold disabled:opacity-40"
                >
                  {compCreating ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )}

          {competitions.length > 0 && (
            <>
              <button
                onClick={() => setShowCompList(!showCompList)}
                className="flex items-center justify-between w-full py-1"
              >
                <p className="text-caption text-ink-secondary font-semibold">
                  {competitions.length} competition{competitions.length !== 1 ? "s" : ""}
                </p>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={`text-ink-muted transition-transform duration-200 ${showCompList ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showCompList && (
                <div className="flex flex-col gap-2">
                  {competitions.map((c) => {
                    const stateLabel = c.state.replace(/_/g, " ");
                    const isActive = ["join_open", "join_closed", "countdown", "live"].includes(c.state);
                    const durationLabel = c.duration_seconds
                      ? c.duration_seconds >= 60 ? `${Math.floor(c.duration_seconds / 60)} min` : `${c.duration_seconds}s`
                      : "Target";
                    return (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/live/${c.id}`)}
                        className="w-full flex items-center justify-between py-3 px-4 bg-bg-surface rounded-lg text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-body text-ink-primary font-semibold truncate">{c.name}</p>
                          <p className="text-caption text-ink-muted">
                            {durationLabel} · {c.team_size === 1 ? "Solo" : `Teams of ${c.team_size}`}
                          </p>
                        </div>
                        <span className={`text-micro font-bold uppercase ml-3 px-2 py-1 rounded-pill ${
                          isActive ? "bg-success/20 text-success" : c.state === "finished" || c.state === "results" ? "bg-accent/20 text-accent" : "bg-ink-muted/20 text-ink-muted"
                        }`}>
                          {stateLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {competitions.length === 0 && !showCreateComp && isOrganizer && (
            <p className="text-caption text-ink-muted text-center py-2">No live competitions yet</p>
          )}
        </div>
      )}

      {/* Detail tabs */}
      <div className="flex gap-1 bg-bg-surface rounded-pill p-1">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setActiveTab(t.value)}
            className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
              activeTab === t.value
                ? "bg-accent text-ink-inverse font-bold"
                : "bg-transparent text-ink-secondary font-medium"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "leaderboard" && (
        <LeaderboardTab
          event={event}
          leaderboard={leaderboard}
          progress={progress}
          isTeamMode={isTeamMode}
          expandedTeamId={expandedTeamId}
          teamMembers={teamMembers}
          callerName={profile?.name || ""}
          profileId={profile?.id}
          onToggleTeam={(teamId) => {
            if (expandedTeamId === teamId) {
              setExpandedTeamId(null);
            } else {
              setExpandedTeamId(teamId);
              fetchTeamMembers(teamId);
            }
          }}
        />
      )}

      {activeTab === "details" && (
        <DetailsTab event={event} creatorName={creatorName} progress={progress} />
      )}

      {activeTab === "qr" && (
        <QRTab
          event={event}
          canvasRef={qrCanvasRef}
          onCopyLink={handleCopyLink}
          onDownload={handleDownloadQR}
          copied={copied}
        />
      )}
    </div>
  );
}

function LeaderboardTab({
  event,
  leaderboard,
  progress,
  isTeamMode,
  expandedTeamId,
  teamMembers,
  onToggleTeam,
  callerName,
  profileId,
}: {
  event: EventData;
  leaderboard: LeaderboardData | null;
  progress: ProgressData | null;
  isTeamMode: boolean;
  expandedTeamId: string | null;
  teamMembers: Record<string, IndividualEntry[]>;
  onToggleTeam: (teamId: string) => void;
  callerName: string;
  profileId: string | undefined;
}) {
  const navigate = useNavigate();
  const entries = leaderboard?.leaderboard || [];
  const caller = leaderboard?.caller;
  const isCompleted = event.status === "completed" || event.status === "archived";

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-body text-ink-muted">No participants yet</p>
      </div>
    );
  }

  // Global target: collaborative progress + contribution list
  if (event.competition_mode === "global_target") {
    return (
      <div className="flex flex-col gap-2">
        {progress && progress.target_reps && (
          <div className="bg-bg-surface rounded-lg p-4 mb-2">
            <p className="text-caption text-ink-secondary mb-2">
              {isCompleted
                ? (progress.total_reps >= progress.target_reps ? "Target reached!" : "Target not reached")
                : "Working together toward the goal"}
            </p>
            <div className="h-3 bg-bg-input rounded-pill overflow-hidden">
              <div
                className={`h-full rounded-pill transition-all duration-300 ease-apple ${
                  isCompleted && progress.total_reps >= progress.target_reps ? "bg-success" : "bg-accent"
                }`}
                style={{ width: `${Math.min(100, progress.percentage || 0)}%` }}
              />
            </div>
            <p className="text-body text-ink-primary font-bold mt-2">
              {formatNumber(progress.total_reps)} / {formatNumber(progress.target_reps)}
            </p>
          </div>
        )}
        <p className="text-micro text-ink-muted uppercase tracking-wide">Contributions</p>
        {(entries as IndividualEntry[]).map((entry, i) => (
          <button
            key={entry.user_id}
            onClick={() => {
              if (profileId && entry.user_id === profileId) navigate("/profile");
              else navigate(`/user/${entry.user_id}`);
            }}
            className={`w-full flex items-center py-3 px-4 bg-bg-surface rounded-lg text-left ${isCompleted && i === 0 ? "ring-1 ring-accent/30" : ""}`}
          >
            <span className="w-8 text-center flex-shrink-0">
              {i < 3 ? <span className="text-body-lg">{MEDALS[i]}</span> : <span className="text-body text-ink-muted">{i + 1}.</span>}
            </span>
            <div className="ml-2">
              <Avatar url={entry.avatar_url} name={entry.user_name} />
            </div>
            <span className="ml-3 text-body text-ink-primary truncate flex-1">{entry.user_name}</span>
            <span className="text-body text-accent font-bold tabular-nums ml-2">{formatNumber(entry.total_reps)}</span>
          </button>
        ))}
      </div>
    );
  }

  // Team vs Team: two-column head-to-head
  if (event.competition_mode === "team_vs_team") {
    const teamEntries = entries as TeamEntry[];
    const team1 = teamEntries[0];
    const team2 = teamEntries[1];

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[team1, team2].filter(Boolean).map((team) => {
            const isWinner = isCompleted && team.rank === 1;
            return (
              <button
                key={team.team_id}
                onClick={() => onToggleTeam(team.team_id)}
                className={`bg-bg-surface rounded-lg p-4 text-center ${isWinner ? "ring-1 ring-accent/30" : ""}`}
              >
                {isWinner && <p className="text-micro text-accent font-bold mb-1">WINNER</p>}
                <p className="text-body text-ink-primary font-semibold truncate">{team.team_name}</p>
                <p className="text-display-md text-accent font-bold mt-2 tabular-nums">{formatNumber(team.total_reps)}</p>
                <p className="text-micro text-ink-muted mt-1">repps</p>
              </button>
            );
          })}
        </div>

        {!team2 && (
          <p className="text-caption text-ink-muted text-center">Waiting for opponent team...</p>
        )}

        {expandedTeamId && teamMembers[expandedTeamId] && (
          <div className="flex flex-col gap-1">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              {teamEntries.find((t) => t.team_id === expandedTeamId)?.team_name} Members
            </p>
            {teamMembers[expandedTeamId].map((m) => (
              <button
                key={m.user_id}
                onClick={() => {
                  if (profileId && m.user_id === profileId) navigate("/profile");
                  else navigate(`/user/${m.user_id}`);
                }}
                className="w-full flex items-center py-2 px-3 bg-bg-elevated rounded-md text-left"
              >
                <Avatar url={m.avatar_url} name={m.user_name} />
                <span className="ml-2 text-caption text-ink-primary truncate flex-1">{m.user_name}</span>
                <span className="text-caption text-accent font-bold tabular-nums ml-2">{formatNumber(m.total_reps)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Team modes: ranked team list
  if (isTeamMode) {
    return (
      <div className="flex flex-col gap-2">
        {(entries as TeamEntry[]).map((entry, i) => (
          <div key={entry.team_id}>
            <button
              onClick={() => onToggleTeam(entry.team_id)}
              className={`w-full flex items-center py-3 px-4 bg-bg-surface rounded-lg text-left ${isCompleted && i === 0 ? "ring-1 ring-accent/30" : ""}`}
            >
              <span className="w-8 text-center flex-shrink-0">
                {i < 3 ? <span className="text-body-lg">{MEDALS[i]}</span> : <span className="text-body text-ink-muted">{i + 1}.</span>}
              </span>
              <div className="ml-2 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span className="ml-3 text-body text-ink-primary truncate flex-1">{entry.team_name}</span>
              <span className="text-body text-accent font-bold tabular-nums ml-2">{formatNumber(entry.total_reps)}</span>
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`ml-2 text-ink-muted transition-transform duration-200 ${expandedTeamId === entry.team_id ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {expandedTeamId === entry.team_id && teamMembers[entry.team_id] && (
              <div className="ml-10 mt-1 flex flex-col gap-1">
                {teamMembers[entry.team_id].map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => {
                      if (profileId && m.user_id === profileId) navigate("/profile");
                      else navigate(`/user/${m.user_id}`);
                    }}
                    className="w-full flex items-center py-2 px-3 bg-bg-elevated rounded-md text-left"
                  >
                    <Avatar url={m.avatar_url} name={m.user_name} />
                    <span className="ml-2 text-caption text-ink-primary truncate flex-1">{m.user_name}</span>
                    <span className="text-caption text-accent font-bold tabular-nums ml-2">{formatNumber(m.total_reps)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {caller && (
          <div className="pt-2 mt-2">
            <p className="text-micro text-ink-secondary uppercase px-2 mb-1">YOUR TEAM</p>
            <div className="flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-t-2 border-accent">
              <span className="w-8 text-center flex-shrink-0 text-body text-ink-muted">{caller.rank}.</span>
              <span className="ml-3 text-body text-ink-primary flex-1">Your team</span>
              <span className="text-body text-accent font-bold tabular-nums ml-2">{formatNumber(caller.total_reps)}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Individual modes: ranked list
  return (
    <div className="flex flex-col gap-2">
      {(entries as IndividualEntry[]).map((entry, i) => (
        <button
          key={entry.user_id}
          onClick={() => {
            if (profileId && entry.user_id === profileId) navigate("/profile");
            else navigate(`/user/${entry.user_id}`);
          }}
          className={`w-full flex items-center py-3 px-4 bg-bg-surface rounded-lg text-left ${isCompleted && i === 0 ? "ring-1 ring-accent/30" : ""}`}
        >
          <span className="w-8 text-center flex-shrink-0">
            {i < 3 ? <span className="text-body-lg">{MEDALS[i]}</span> : <span className="text-body text-ink-muted">{i + 1}.</span>}
          </span>
          <div className="ml-2">
            <Avatar url={entry.avatar_url} name={entry.user_name} />
          </div>
          <span className="ml-3 text-body text-ink-primary truncate flex-1">{entry.user_name}</span>
          <span className="text-body text-accent font-bold tabular-nums ml-2">{formatNumber(entry.total_reps)}</span>
        </button>
      ))}

      {caller && !(entries as IndividualEntry[]).some((e) => e.rank === caller.rank) && (
        <div className="pt-2 mt-2">
          <p className="text-micro text-ink-secondary uppercase px-2 mb-1">YOU</p>
          <div className="flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-t-2 border-accent">
            <span className="w-8 text-center flex-shrink-0 text-body text-ink-muted">{caller.rank}.</span>
            <span className="ml-3 text-body text-ink-primary flex-1">{callerName || "You"}</span>
            <span className="text-body text-accent font-bold tabular-nums ml-2">{formatNumber(caller.total_reps)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailsTab({ event, creatorName, progress }: { event: EventData; creatorName: string; progress: ProgressData | null }) {
  const isTeamMode = event.competition_mode.startsWith("team");
  const sponsors = (event.sponsors || []) as SponsorData[];

  return (
    <div className="flex flex-col gap-4">
      {event.description && (
        <div>
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-1">Description</p>
          <p className="text-body text-ink-secondary whitespace-pre-line">{event.description}</p>
        </div>
      )}

      {event.location && (
        <div className="bg-bg-surface rounded-lg p-4 flex items-start gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0 mt-0.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <div>
            <p className="text-micro text-ink-muted uppercase tracking-wide mb-0.5">Location</p>
            <p className="text-body text-ink-primary">{event.location}</p>
          </div>
        </div>
      )}

      {/* Rules */}
      {event.rules && (
        <div className="bg-bg-surface rounded-lg p-4">
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Rules</p>
          <p className="text-body text-ink-secondary whitespace-pre-line">{event.rules}</p>
        </div>
      )}

      {/* Prizes */}
      {event.prize_type === "custom_prize" && event.prize_description && (
        <div className="bg-bg-surface rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-gold flex-shrink-0">
              <circle cx="12" cy="8" r="7" />
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
            <p className="text-micro text-ink-muted uppercase tracking-wide">Prizes</p>
          </div>
          <p className="text-body text-ink-secondary whitespace-pre-line">{event.prize_description}</p>
        </div>
      )}

      {/* Sponsors */}
      {sponsors.length > 0 && (
        <div>
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Sponsors</p>
          <div className="flex flex-col gap-2">
            {sponsors.map((sponsor, i) => {
              const content = (
                <div className="bg-bg-surface rounded-lg p-3 flex items-center gap-3">
                  {sponsor.logo_url ? (
                    <img
                      src={sponsor.logo_url}
                      alt={sponsor.name}
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-body font-bold text-accent">{sponsor.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-ink-primary font-semibold truncate">{sponsor.name}</p>
                    {sponsor.link_url && (
                      <p className="text-micro text-accent truncate">{sponsor.link_url.replace(/^https?:\/\//, "")}</p>
                    )}
                  </div>
                  {sponsor.link_url && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted flex-shrink-0">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  )}
                </div>
              );

              return sponsor.link_url ? (
                <a key={i} href={sponsor.link_url} target="_blank" rel="noopener noreferrer" className="block">
                  {content}
                </a>
              ) : (
                <div key={i}>{content}</div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-bg-surface rounded-lg p-4 flex flex-col gap-3">
        <DetailRow label="Created by" value={creatorName} />
        <DetailRow label="Category" value={event.category === "official" ? "Official" : "Community"} />
        <DetailRow label="Mode" value={MODE_LABELS[event.competition_mode] || event.competition_mode} />
        {event.sprint_duration_minutes && (
          <DetailRow label="Sprint duration" value={`${event.sprint_duration_minutes} minutes`} />
        )}
        <DetailRow label="Scoring" value={event.scoring_method === "rep_score" ? "Repp Score" : "Raw Repps"} />
        {event.target_reps && (
          <DetailRow label="Target" value={`${formatNumber(event.target_reps)} repps`} />
        )}
        {event.prize_type === "bragging_rights" && (
          <DetailRow label="Prize" value="Bragging rights" />
        )}
        <DetailRow label="Late join" value={event.allow_late_join ? "Allowed" : "Not allowed"} />
        <DetailRow label="Retroactive repps" value={event.retroactive_reps ? "Yes" : "No"} />
        <DetailRow label="Visibility" value={event.visibility === "public" ? "Public" : "Invite only"} />
        <DetailRow
          label="Participants"
          value={isTeamMode
            ? `${progress?.team_count || 0} team${(progress?.team_count || 0) !== 1 ? "s" : ""}`
            : `${progress?.participant_count || 0}`}
        />
        <DetailRow label="Starts" value={new Date(event.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} />
        <DetailRow label="Ends" value={new Date(event.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-caption text-ink-muted flex-shrink-0">{label}</span>
      <span className="text-caption text-ink-primary text-right">{value}</span>
    </div>
  );
}

function QRTab({
  event,
  canvasRef,
  onCopyLink,
  onDownload,
  copied,
}: {
  event: EventData;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onCopyLink: () => void;
  onDownload: () => void;
  copied: boolean;
}) {
  const joinUrl = `${window.location.origin}/events/join/${event.join_code}`;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="bg-bg-surface rounded-lg p-6 flex flex-col items-center gap-4">
        <canvas ref={canvasRef} className="rounded-md" />
        <p className="text-caption text-ink-muted text-center break-all">{joinUrl}</p>
      </div>

      <div className="w-full flex gap-3">
        <button
          onClick={onCopyLink}
          className="flex-1 py-4 rounded-pill bg-bg-elevated text-ink-primary font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
        >
          {copied ? "Copied!" : "Copy Link"}
        </button>
        <button
          onClick={onDownload}
          className="flex-1 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
        >
          Download QR
        </button>
      </div>
    </div>
  );
}

