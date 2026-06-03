import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/format";
import { formatTimeStatus } from "../lib/eventTime";
import { useAuth } from "../contexts/AuthContext";
import ModeIcon from "../components/ModeIcon";

type CategoryTab = "featured" | "official" | "community" | "my_events";

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  banner_url: string | null;
  category: "official" | "community";
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
}

interface EventWithCounts extends EventRow {
  participant_count: number;
  team_count: number;
  total_reps: number;
}

const CATEGORY_TABS: { label: string; value: CategoryTab }[] = [
  { label: "Featured", value: "featured" },
  { label: "Official", value: "official" },
  { label: "Community", value: "community" },
  { label: "My Events", value: "my_events" },
];

const MODE_CONFIG: Record<string, { label: string; icon: string }> = {
  global_target: { label: "Global Target", icon: "globe" },
  individual_most: { label: "Most Reps", icon: "person" },
  individual_target: { label: "Target", icon: "person" },
  team_most: { label: "Team Most", icon: "group" },
  team_target: { label: "Team Target", icon: "group" },
  team_vs_team: { label: "Team vs Team", icon: "group" },
  live_sprint: { label: "Live Sprint", icon: "timer" },
};


function EventCard({ event, onClick }: { event: EventWithCounts; onClick: () => void }) {
  const mode = MODE_CONFIG[event.competition_mode] || { label: event.competition_mode, icon: "person" };
  const time = formatTimeStatus(event);
  const isTargetMode = ["global_target", "individual_target", "team_target"].includes(event.competition_mode);
  const isTeamMode = ["team_most", "team_target", "team_vs_team"].includes(event.competition_mode);
  const progress = isTargetMode && event.target_reps ? Math.min(100, (event.total_reps / event.target_reps) * 100) : 0;

  return (
    <button onClick={onClick} className="w-full bg-bg-surface rounded-lg overflow-hidden text-left transition-all duration-200 ease-apple active:scale-[0.98]">
      {event.banner_url && (
        <img
          src={event.banner_url}
          alt=""
          className="w-full aspect-video object-cover"
        />
      )}
      <div className="p-4">
        <p className="text-body text-ink-primary font-semibold leading-tight">{event.name}</p>

        <div className="flex items-center gap-1.5 mt-2">
          <span className="flex items-center gap-1 text-micro text-accent font-bold">
            <ModeIcon mode={mode.icon} size={14} className="text-accent" />
            {mode.label}
          </span>
          {isTargetMode && event.target_reps && (
            <span className="text-micro text-ink-muted">· {formatNumber(event.target_reps)} repps</span>
          )}
        </div>

        <p className={`text-caption mt-1.5 ${time.isLive ? "text-success font-semibold" : time.isCompleted ? "text-ink-muted" : "text-ink-secondary"}`}>
          {time.text}
        </p>

        <p className="text-micro text-ink-muted mt-1.5">
          {isTeamMode
            ? `${event.team_count} team${event.team_count !== 1 ? "s" : ""}`
            : `${event.participant_count} participant${event.participant_count !== 1 ? "s" : ""}`}
        </p>

        {isTargetMode && event.target_reps && (
          <div className="mt-2.5">
            <div className="h-1.5 bg-bg-input rounded-pill overflow-hidden">
              <div
                className="h-full bg-accent rounded-pill transition-all duration-300 ease-apple"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-micro text-ink-muted mt-1">
              {formatNumber(event.total_reps)} / {formatNumber(event.target_reps)} · {Math.round(progress)}%
            </p>
          </div>
        )}

        {event.prize_type === "custom_prize" && event.prize_description && (
          <div className="mt-2 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-accent-gold flex-shrink-0">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
            </svg>
            <span className="text-micro text-accent-gold font-semibold truncate">{event.prize_description}</span>
          </div>
        )}
      </div>
    </button>
  );
}

async function transitionStaleStatuses(events: EventRow[]): Promise<EventRow[]> {
  const now = Date.now();
  const updated: EventRow[] = [];
  for (const e of events) {
    let status = e.status;
    if (status === "announced" && new Date(e.starts_at).getTime() <= now) {
      await supabase.from("events").update({ status: "active" }).eq("id", e.id);
      status = "active";
    }
    if (status === "active" && new Date(e.ends_at).getTime() <= now) {
      await supabase.rpc("complete_event", { p_event_id: e.id });
      status = "completed";
    }
    updated.push({ ...e, status });
  }
  return updated;
}

interface MyEventChip {
  id: string;
  name: string;
  status: string;
  ends_at: string;
}

export default function Events() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<CategoryTab>("featured");
  const [events, setEvents] = useState<EventWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [myEvents, setMyEvents] = useState<MyEventChip[]>([]);

  useEffect(() => {
    if (!profile) { setMyEvents([]); return; }
    async function fetchMyEvents() {
      const [{ data: created }, { data: participated }] = await Promise.all([
        supabase
          .from("events")
          .select("id, name, status, ends_at")
          .eq("created_by", profile!.id)
          .neq("status", "archived")
          .order("starts_at", { ascending: false }),
        supabase
          .from("event_participants")
          .select("event_id")
          .eq("user_id", profile!.id)
          .eq("status", "active"),
      ]);

      const eventMap = new Map<string, MyEventChip>();
      (created || []).forEach((e) => eventMap.set(e.id, e));

      const joinedIds = (participated || [])
        .map((p) => p.event_id)
        .filter((id) => !eventMap.has(id));

      if (joinedIds.length > 0) {
        const { data: joinedEvents } = await supabase
          .from("events")
          .select("id, name, status, ends_at")
          .in("id", joinedIds)
          .neq("status", "archived");
        (joinedEvents || []).forEach((e) => eventMap.set(e.id, e));
      }

      setMyEvents(Array.from(eventMap.values()));
    }
    fetchMyEvents();
  }, [profile]);

  // Realtime subscription for participant joins
  useEffect(() => {
    const channel = supabase
      .channel("event-participants-hub")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_participants" },
        () => { fetchEventsRef.current?.(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchEventsRef = useRef<(() => void) | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("events")
      .select("*")
      .neq("status", "draft")
      .order("starts_at", { ascending: false });

    if (tab === "featured") {
      query = supabase
        .from("events")
        .select("*")
        .neq("status", "draft")
        .or("is_featured.eq.true,category.eq.official")
        .order("is_featured", { ascending: false })
        .order("starts_at", { ascending: false });
    } else if (tab === "official") {
      query = supabase
        .from("events")
        .select("*")
        .eq("category", "official")
        .neq("status", "draft")
        .order("starts_at", { ascending: false });
    } else if (tab === "community") {
      query = supabase
        .from("events")
        .select("*")
        .eq("category", "community")
        .eq("visibility", "public")
        .neq("status", "draft")
        .order("starts_at", { ascending: false });
    } else if (tab === "my_events") {
      if (!profile) {
        setEvents([]);
        setLoading(false);
        return;
      }
      // Fetch events user created or is participating in
      const [{ data: created }, { data: participated }] = await Promise.all([
        supabase
          .from("events")
          .select("*")
          .eq("created_by", profile.id)
          .order("starts_at", { ascending: false }),
        supabase
          .from("event_participants")
          .select("event_id")
          .eq("user_id", profile.id)
          .eq("status", "active"),
      ]);

      const participatedIds = (participated || []).map((p) => p.event_id);
      let allEvents = created || [];

      if (participatedIds.length > 0) {
        const { data: joinedEvents } = await supabase
          .from("events")
          .select("*")
          .in("id", participatedIds);
        if (joinedEvents) {
          const existingIds = new Set(allEvents.map((e) => e.id));
          for (const e of joinedEvents) {
            if (!existingIds.has(e.id)) allEvents.push(e);
          }
        }
      }

      allEvents.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

      const transitioned = await transitionStaleStatuses(allEvents);
      const withCounts = await enrichEvents(transitioned);
      setEvents(withCounts);
      setLoading(false);
      return;
    }

    const { data, error } = await query;
    if (error) {
      console.error("Events fetch error:", error);
      setEvents([]);
      setLoading(false);
      return;
    }

    const transitioned = await transitionStaleStatuses(data || []);
    const withCounts = await enrichEvents(transitioned);
    setEvents(withCounts);
    setLoading(false);
  }, [tab, profile]);

  useEffect(() => {
    fetchEventsRef.current = fetchEvents;
  }, [fetchEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Create button */}
      {profile && (
        <div className="flex justify-end -mb-2">
          <button
            onClick={() => navigate("/events/create")}
            className="flex items-center gap-1.5 py-2 px-4 rounded-pill bg-accent text-ink-inverse font-semibold text-caption transition-all duration-200 ease-apple active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create
          </button>
        </div>
      )}

      {/* Your Events */}
      {myEvents.length > 0 && (
        <div>
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Your Events</p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            {myEvents.map((e) => {
              const diff = new Date(e.ends_at).getTime() - Date.now();
              const timeLabel = e.status === "completed"
                ? "Completed"
                : e.status === "draft"
                  ? "Draft"
                  : diff <= 0
                    ? "Ending"
                    : (() => {
                        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        return d > 0 ? `${d}d left` : `${h}h left`;
                      })();
              const statusColor = e.status === "active" ? "bg-success" : e.status === "announced" ? "bg-accent" : "bg-ink-muted";
              return (
                <button
                  key={e.id}
                  onClick={() => navigate(`/events/${e.id}`)}
                  className="flex-shrink-0 bg-bg-surface rounded-lg px-3 py-2 text-left transition-all duration-200 ease-apple active:scale-[0.97]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColor} flex-shrink-0`} />
                    <span className="text-caption text-ink-primary font-semibold truncate max-w-[10rem]">{e.name}</span>
                  </div>
                  <p className="text-micro text-ink-muted mt-0.5">{timeLabel}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 bg-bg-surface rounded-pill p-1">
        {CATEGORY_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
              tab === t.value
                ? "bg-accent text-ink-inverse font-bold"
                : "bg-transparent text-ink-secondary font-medium"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-body text-ink-muted">
            {tab === "my_events" && !profile
              ? "Sign in to see your events"
              : tab === "my_events"
                ? "You haven't joined any events yet"
                : "No events yet"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => navigate(`/events/${event.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function enrichEvents(events: EventRow[]): Promise<EventWithCounts[]> {
  if (events.length === 0) return [];

  const enriched: EventWithCounts[] = [];

  for (const event of events) {
    const { data } = await supabase.rpc("get_event_progress", {
      p_event_id: event.id,
    });

    enriched.push({
      ...event,
      participant_count: data?.participant_count ?? 0,
      team_count: data?.team_count ?? 0,
      total_reps: data?.total_reps ?? 0,
    });
  }

  return enriched;
}
