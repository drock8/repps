import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { flagEmoji } from "../lib/flagEmoji";
import { generateStyledQRDataUrl } from "../lib/qrRenderer";

// ─── Types ───────────────────────────────────────────────────────
interface Participant {
  participant_id: string;
  user_id: string;
  competition_team_id: string | null;
  status: string;
  entry_type: string;
  name: string;
  avatar_url: string | null;
  nationality_code: string | null;
  gender: string;
}

interface CompTeam {
  id: string;
  name: string;
  created_by: string;
}

interface CompState {
  id: string;
  name: string;
  state: string;
  team_size: number;
  duration_seconds: number | null;
  target_reps: number | null;
  target_type: string;
  join_code: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EventInfo {
  id: string;
  name: string;
  banner_url: string | null;
  created_by: string;
}

// ─── Admin Panel ─────────────────────────────────────────────────
function AdminOverlay({
  comp,
  onTransition,
}: {
  comp: CompState;
  onTransition: (state: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const actions: { label: string; state: string; danger?: boolean }[] = (() => {
    switch (comp.state) {
      case "draft":
        return [{ label: "Open Entries", state: "join_open" }];
      case "announced":
        return [{ label: "Open Entries", state: "join_open" }];
      case "join_open":
        return [
          { label: "Close Entries", state: "join_closed" },
          { label: "Start Countdown", state: "countdown" },
        ];
      case "join_closed":
        return [
          { label: "Re-open Entries", state: "join_open" },
          { label: "Start Countdown", state: "countdown" },
        ];
      case "countdown":
        return [{ label: "Cancel", state: "join_closed" }];
      case "live":
        return [{ label: "End Competition", state: "finished", danger: true }];
      case "finished":
        return [{ label: "Show Results", state: "results" }];
      default:
        return [];
    }
  })();

  function handleAction(state: string, danger?: boolean) {
    if (danger && confirming !== state) {
      setConfirming(state);
      return;
    }
    setConfirming(null);
    onTransition(state);
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-accent text-ink-inverse flex items-center justify-center shadow-lg text-headline"
      >
        ⚡
      </button>
      {open && (
        <div className="fixed bottom-24 left-6 z-50 bg-bg-elevated rounded-lg p-4 shadow-xl min-w-[240px] border border-divider">
          <p className="text-micro text-ink-muted uppercase tracking-widest mb-1">Admin</p>
          <p className="text-caption text-ink-secondary mb-3">
            State: <span className="text-ink-primary font-semibold">{comp.state.replace(/_/g, " ")}</span>
          </p>
          <div className="flex flex-col gap-2">
            {actions.map((a) => (
              <button
                key={a.state}
                onClick={() => handleAction(a.state, a.danger)}
                className={`py-3 px-4 rounded-md text-body font-semibold text-left transition-colors ${
                  a.danger
                    ? confirming === a.state
                      ? "bg-error text-white"
                      : "bg-error/20 text-error"
                    : "bg-accent/20 text-accent"
                }`}
              >
                {confirming === a.state ? "Confirm?" : a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Countdown Overlay ───────────────────────────────────────────
function CountdownOverlay({ onComplete }: { onComplete: () => void }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onComplete]);

  return (
    <div className="fixed inset-0 z-40 bg-bg-base/90 flex items-center justify-center">
      <div
        key={count}
        className="text-[200px] font-bold text-accent animate-pulse leading-none"
      >
        {count === 0 ? "GO!" : count}
      </div>
    </div>
  );
}

// ─── Timer Display ───────────────────────────────────────────────
function Timer({
  comp,
}: {
  comp: CompState;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (comp.state !== "live" || !comp.started_at) return;
    const start = new Date(comp.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [comp.state, comp.started_at]);

  if (comp.state !== "live" && comp.state !== "finished") return null;

  const remaining =
    comp.target_type === "timer" && comp.duration_seconds
      ? Math.max(0, comp.duration_seconds - elapsed)
      : null;

  const display = remaining !== null ? remaining : elapsed;
  const minutes = Math.floor(display / 60);
  const seconds = display % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const urgency =
    remaining !== null && remaining <= 10
      ? "text-error"
      : remaining !== null && remaining <= 60
        ? "text-[#FFC857]"
        : "text-ink-primary";

  return (
    <span className={`font-bold tabular-nums ${urgency}`}>{timeStr}</span>
  );
}

// ─── Participant Card ────────────────────────────────────────────
function ParticipantCard({
  p,
  reps,
  rank,
  live,
}: {
  p: Participant;
  reps: number;
  rank: number | null;
  live: boolean;
}) {
  const flag = p.nationality_code ? flagEmoji(p.nationality_code) : "";
  const displayReps = useAnimatedCounter(reps);

  return (
    <div className="bg-bg-surface rounded-lg p-4 flex flex-col items-center gap-2 min-w-[160px] relative">
      {rank !== null && rank <= 3 && live && (
        <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-accent text-ink-inverse text-caption font-bold flex items-center justify-center">
          {rank}
        </div>
      )}
      {p.avatar_url ? (
        <img
          src={p.avatar_url}
          alt=""
          referrerPolicy="no-referrer"
          className="w-14 h-14 rounded-full object-cover"
        />
      ) : (
        <div className="w-14 h-14 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-headline font-bold">
          {p.name.charAt(0).toUpperCase()}
        </div>
      )}
      <p className="text-[18px] font-semibold text-ink-primary truncate max-w-[140px]">
        {p.name}
      </p>
      {flag && <p className="text-[20px] leading-none">{flag}</p>}
      {live ? (
        <div className="text-center">
          <p className="text-[28px] font-bold text-accent leading-tight">{displayReps}</p>
          <p className="text-[13px] text-ink-muted">reps</p>
        </div>
      ) : (
        <p
          className={`text-[13px] font-semibold px-3 py-1 rounded-full ${
            p.status === "camera_ready"
              ? "bg-success/20 text-success"
              : "bg-[#FFC857]/20 text-[#FFC857]"
          }`}
        >
          {p.status === "camera_ready" ? "Ready" : "Joining…"}
        </p>
      )}
    </div>
  );
}

// ─── Sidebar Leaderboard ─────────────────────────────────────────
function Sidebar({
  participants,
  teams,
  repMap,
  teamSize,
}: {
  participants: Participant[];
  teams: CompTeam[];
  repMap: Map<string, number>;
  teamSize: number;
}) {
  const individualRanked = useMemo(() => {
    return [...participants]
      .map((p) => ({ ...p, reps: repMap.get(p.user_id) || 0 }))
      .sort((a, b) => b.reps - a.reps);
  }, [participants, repMap]);

  const teamRanked = useMemo(() => {
    if (teamSize <= 1) return [];
    return teams
      .map((t) => {
        const members = participants.filter((p) => p.competition_team_id === t.id);
        const total = members.reduce((sum, m) => sum + (repMap.get(m.user_id) || 0), 0);
        return { ...t, total, members };
      })
      .sort((a, b) => b.total - a.total);
  }, [teams, participants, repMap, teamSize]);

  const maxReps = individualRanked[0]?.reps || 1;
  const maxTeam = teamRanked[0]?.total || 1;

  return (
    <div className="w-[280px] flex-shrink-0 bg-bg-surface/50 border-l border-divider p-5 overflow-y-auto flex flex-col gap-6">
      {teamSize > 1 && teamRanked.length > 0 && (
        <div>
          <h3 className="text-micro text-ink-muted uppercase tracking-widest mb-3">Teams</h3>
          <div className="flex flex-col gap-2">
            {teamRanked.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2">
                <span
                  className={`text-[16px] font-bold w-6 text-right ${
                    i < 3 ? "text-accent" : "text-ink-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[15px] text-ink-primary truncate">{t.name}</span>
                    <span className="text-[15px] font-bold text-accent ml-2">{t.total}</span>
                  </div>
                  <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${(t.total / maxTeam) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-micro text-ink-muted uppercase tracking-widest mb-3">Individuals</h3>
        <div className="flex flex-col gap-2">
          {individualRanked.slice(0, 20).map((p, i) => (
            <div key={p.user_id} className="flex items-center gap-2">
              <span
                className={`text-[16px] font-bold w-6 text-right ${
                  i < 3 ? "text-accent" : "text-ink-muted"
                }`}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[15px] text-ink-primary truncate">{p.name}</span>
                  <span className="text-[15px] font-bold text-accent ml-2">{p.reps}</span>
                </div>
                <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${(p.reps / maxReps) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Finish Overlay ──────────────────────────────────────────────
function FinishOverlay({
  participants,
  teams,
  repMap,
  totalReps,
  teamSize,
}: {
  participants: Participant[];
  teams: CompTeam[];
  repMap: Map<string, number>;
  totalReps: number;
  teamSize: number;
}) {
  const ranked = useMemo(() => {
    return [...participants]
      .map((p) => ({ ...p, reps: repMap.get(p.user_id) || 0 }))
      .sort((a, b) => b.reps - a.reps);
  }, [participants, repMap]);

  const topTeam = useMemo(() => {
    if (teamSize <= 1) return null;
    return teams
      .map((t) => {
        const members = participants.filter((p) => p.competition_team_id === t.id);
        const total = members.reduce((sum, m) => sum + (repMap.get(m.user_id) || 0), 0);
        return { ...t, total };
      })
      .sort((a, b) => b.total - a.total)[0] || null;
  }, [teams, participants, repMap, teamSize]);

  return (
    <div className="fixed inset-0 z-30 bg-bg-base/85 flex items-center justify-center">
      <div className="text-center max-w-lg">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">Competition Complete</p>
        <p className="text-[80px] font-bold text-accent leading-none mb-2">{totalReps}</p>
        <p className="text-headline text-ink-secondary mb-8">total reps · {participants.length} participants</p>

        {topTeam && (
          <div className="mb-6">
            <p className="text-micro text-ink-muted uppercase tracking-widest mb-1">Best Team</p>
            <p className="text-display-md text-ink-primary">{topTeam.name}</p>
            <p className="text-headline text-accent">{topTeam.total} reps</p>
          </div>
        )}

        <div className="flex justify-center gap-8">
          {ranked.slice(0, 3).map((p, i) => (
            <div key={p.user_id} className="text-center">
              <p className="text-[32px] mb-1">{["🥇", "🥈", "🥉"][i]}</p>
              {p.avatar_url ? (
                <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className="w-16 h-16 rounded-full object-cover mx-auto mb-2" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-headline font-bold mx-auto mb-2">
                  {p.name.charAt(0).toUpperCase()}
                </div>
              )}
              <p className="text-body-lg text-ink-primary font-semibold">{p.name}</p>
              <p className="text-headline text-accent">{p.reps}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────
export default function LiveDashboard() {
  const { competitionId } = useParams<{ competitionId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [comp, setComp] = useState<CompState | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<CompTeam[]>([]);
  const [repMap, setRepMap] = useState<Map<string, number>>(new Map());
  const [totalReps, setTotalReps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCountdown, setShowCountdown] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const repMapRef = useRef(repMap);
  repMapRef.current = repMap;

  const isOrganizer = profile && event && profile.id === event.created_by;
  const isParticipant = profile && participants.some((p) => p.user_id === profile.id);

  // Load initial dashboard data
  const loadDashboard = useCallback(async () => {
    if (!competitionId) return;
    const { data } = await supabase.rpc("get_competition_dashboard", {
      p_competition_id: competitionId,
    });
    if (!data?.success) return;

    setComp(data.competition);
    setEvent(data.event);
    setParticipants(data.participants);
    setTeams(data.teams);
    setTotalReps(data.total_qualified_reps);

    const map = new Map<string, number>();
    for (const r of data.reps) {
      map.set(r.user_id, r.qualified_reps);
    }
    setRepMap(map);

    if (data.competition.state === "countdown") {
      setShowCountdown(true);
    }

    setLoading(false);
  }, [competitionId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Generate QR code for join
  useEffect(() => {
    if (!comp?.join_code) return;
    const url = `${window.location.origin}/compete/${comp.join_code}`;
    generateStyledQRDataUrl(url, 200).then(setQrUrl);
  }, [comp?.join_code]);

  // Realtime: participant changes
  useEffect(() => {
    if (!competitionId) return;
    const channel = supabase
      .channel(`comp-participants-${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_participants",
          filter: `competition_id=eq.${competitionId}`,
        },
        () => {
          loadDashboard();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId, loadDashboard]);

  // Realtime: competition state changes
  useEffect(() => {
    if (!competitionId) return;
    const channel = supabase
      .channel(`comp-state-${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "competition_settings",
          filter: `id=eq.${competitionId}`,
        },
        (payload) => {
          const newState = payload.new as any;
          setComp((prev) =>
            prev
              ? {
                  ...prev,
                  state: newState.state,
                  started_at: newState.started_at,
                  finished_at: newState.finished_at,
                }
              : prev
          );
          if (newState.state === "countdown") setShowCountdown(true);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId]);

  // Realtime: competition reps (the critical hot path)
  useEffect(() => {
    if (!competitionId) return;
    const channel = supabase
      .channel(`comp-reps-${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "competition_reps",
          filter: `competition_id=eq.${competitionId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!row.qualified) return;
          setRepMap((prev) => {
            const next = new Map(prev);
            next.set(row.user_id, (next.get(row.user_id) || 0) + 1);
            return next;
          });
          setTotalReps((prev) => prev + 1);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId]);

  // Auto-finish when timer expires
  useEffect(() => {
    if (!comp || comp.state !== "live" || comp.target_type !== "timer" || !comp.started_at || !comp.duration_seconds) return;
    const end = new Date(comp.started_at).getTime() + comp.duration_seconds * 1000;
    const remaining = end - Date.now();
    if (remaining <= 0) return;
    const t = setTimeout(async () => {
      if (isOrganizer) {
        await supabase.rpc("transition_competition_state", {
          p_competition_id: comp.id,
          p_new_state: "finished",
        });
      }
    }, remaining);
    return () => clearTimeout(t);
  }, [comp, isOrganizer]);

  const handleTransition = useCallback(
    async (newState: string) => {
      if (!comp) return;
      if (newState === "countdown") {
        setShowCountdown(true);
      }
      await supabase.rpc("transition_competition_state", {
        p_competition_id: comp.id,
        p_new_state: newState,
      });
    },
    [comp]
  );

  const handleCountdownComplete = useCallback(async () => {
    setShowCountdown(false);
    if (comp && isOrganizer) {
      await supabase.rpc("transition_competition_state", {
        p_competition_id: comp.id,
        p_new_state: "live",
      });
    }
  }, [comp, isOrganizer]);

  // Rank participants by reps
  const ranked = useMemo(() => {
    return [...participants]
      .map((p) => ({ ...p, reps: repMap.get(p.user_id) || 0 }))
      .sort((a, b) => b.reps - a.reps);
  }, [participants, repMap]);

  const rankOf = useCallback(
    (userId: string) => {
      const idx = ranked.findIndex((r) => r.user_id === userId);
      return idx >= 0 ? idx + 1 : null;
    },
    [ranked]
  );

  const animatedTotal = useAnimatedCounter(totalReps);

  if (loading || !comp) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isLive = comp.state === "live";
  const isFinished = comp.state === "finished" || comp.state === "results";
  const isPreLobby = !isLive && !isFinished && comp.state !== "countdown";

  return (
    <div className="fixed inset-0 bg-bg-base text-ink-primary overflow-hidden flex flex-col select-none">
      {/* Header */}
      <header className="h-16 flex items-center px-6 border-b border-divider flex-shrink-0">
        <div className="flex-1">
          <h1 className="text-[28px] font-bold truncate">{comp.name}</h1>
        </div>
        <div className="text-center flex-1">
          <span className="text-[48px] font-bold text-accent leading-none tabular-nums">
            {animatedTotal}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-end gap-4">
          {isLive && (
            <span className="flex items-center gap-2 text-[18px] font-semibold">
              <span className="w-3 h-3 rounded-full bg-error animate-pulse" />
              LIVE
            </span>
          )}
          <span className="text-[40px]">
            <Timer comp={comp} />
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isPreLobby && (
            <div className="flex flex-col items-center">
              <p className="text-micro text-accent uppercase tracking-widest mb-1">REPPs Live</p>
              <p className="text-headline text-ink-secondary mb-6">
                {comp.state === "join_open"
                  ? "Scan the QR code to join"
                  : comp.state === "join_closed"
                    ? "Entries closed — ready to start"
                    : "Coming soon"}
              </p>
              {qrUrl && comp.state === "join_open" && (
                <div className="mb-4 bg-white p-3 rounded-lg">
                  <img src={qrUrl} alt="Join QR" className="w-[200px] h-[200px]" />
                </div>
              )}
              {comp.state === "join_open" && (
                <p className="text-body text-ink-muted mb-6 font-mono tracking-wider">
                  {comp.join_code}
                </p>
              )}
            </div>
          )}

          {/* Participant grid */}
          {comp.team_size > 1 && teams.length > 0 ? (
            <div className="flex flex-col gap-6">
              {teams.map((team) => {
                const members = participants.filter(
                  (p) => p.competition_team_id === team.id
                );
                const teamTotal = members.reduce(
                  (s, m) => s + (repMap.get(m.user_id) || 0),
                  0
                );
                return (
                  <div key={team.id} className="bg-bg-elevated/50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-[22px] font-semibold">{team.name}</h2>
                      {isLive && (
                        <span className="text-[22px] font-bold text-accent">
                          {teamTotal} reps
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 flex-wrap">
                      {members.map((p) => (
                        <ParticipantCard
                          key={p.user_id}
                          p={p}
                          reps={repMap.get(p.user_id) || 0}
                          rank={rankOf(p.user_id)}
                          live={isLive || isFinished}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Individuals without a team */}
              {(() => {
                const solos = participants.filter((p) => !p.competition_team_id);
                if (solos.length === 0) return null;
                return (
                  <div className="bg-bg-elevated/50 rounded-xl p-4">
                    <h2 className="text-[22px] font-semibold mb-3">Individuals</h2>
                    <div className="flex gap-4 flex-wrap">
                      {solos.map((p) => (
                        <ParticipantCard
                          key={p.user_id}
                          p={p}
                          reps={repMap.get(p.user_id) || 0}
                          rank={rankOf(p.user_id)}
                          live={isLive || isFinished}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="flex gap-4 flex-wrap justify-center">
              {participants.map((p) => (
                <ParticipantCard
                  key={p.user_id}
                  p={p}
                  reps={repMap.get(p.user_id) || 0}
                  rank={rankOf(p.user_id)}
                  live={isLive || isFinished}
                />
              ))}
            </div>
          )}

          {participants.length === 0 && isPreLobby && (
            <p className="text-center text-ink-muted text-body-lg mt-8">
              Waiting for participants…
            </p>
          )}

          {/* Participant counter */}
          <p className="text-center text-ink-secondary text-body mt-6">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Sidebar leaderboard — only during live/finished */}
        {(isLive || isFinished) && (
          <Sidebar
            participants={participants}
            teams={teams}
            repMap={repMap}
            teamSize={comp.team_size}
          />
        )}
      </div>

      {/* Overlays */}
      {showCountdown && <CountdownOverlay onComplete={handleCountdownComplete} />}
      {isFinished && (
        <FinishOverlay
          participants={participants}
          teams={teams}
          repMap={repMap}
          totalReps={totalReps}
          teamSize={comp.team_size}
        />
      )}
      {isOrganizer && <AdminOverlay comp={comp} onTransition={handleTransition} />}

      {/* Participant: Start Reps button */}
      {isParticipant && !isFinished && (
        <button
          onClick={() => navigate(`/dab?comp=${comp.id}`)}
          className="fixed bottom-6 right-6 z-50 px-6 py-4 rounded-full bg-accent text-ink-inverse text-body-lg font-bold shadow-lg active:scale-95 transition-transform"
        >
          {isLive ? "Do Reps" : "Get Ready"}
        </button>
      )}
    </div>
  );
}
