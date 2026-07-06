import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { flagEmoji } from "../lib/flagEmoji";
import { generateStyledQRDataUrl } from "../lib/qrRenderer";
import { runConfetti } from "../lib/confetti";

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
  nationality_name: string | null;
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
  winner_categories: string[];
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
  siblingComps,
  onTransition,
  onNavigateComp,
  onRename,
  onDelete,
  onBackToEvent,
}: {
  comp: CompState;
  siblingComps: { id: string; name: string; state: string }[];
  onTransition: (state: string) => void;
  onNavigateComp: (id: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onBackToEvent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(comp.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = !["live", "countdown"].includes(comp.state);

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
        className="fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full bg-accent flex items-center justify-center shadow-lg"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="black" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 2L4.094 12.688a.5.5 0 0 0 .39.812H11l-1 8.5 9-11.188a.5.5 0 0 0-.39-.812H13l1-8z" />
        </svg>
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
          <div className="border-t border-divider my-2" />
          {renaming ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameName.trim()) {
                    onRename(renameName.trim());
                    setRenaming(false);
                  }
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="flex-1 py-2 px-3 rounded-md bg-bg-base text-ink-primary text-body border border-divider"
                maxLength={60}
              />
              <button
                onClick={() => { if (renameName.trim()) { onRename(renameName.trim()); setRenaming(false); } }}
                className="py-2 px-3 rounded-md bg-accent text-ink-inverse text-caption font-semibold"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => { setRenameName(comp.name); setRenaming(true); }}
                className="flex-1 py-2.5 px-3 rounded-md bg-bg-surface text-ink-secondary text-caption font-semibold text-left"
              >
                Rename
              </button>
              {canDelete && (
                <button
                  onClick={() => {
                    if (confirmDelete) { onDelete(); }
                    else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
                  }}
                  className={`py-2.5 px-3 rounded-md text-caption font-semibold ${
                    confirmDelete ? "bg-error text-white" : "bg-error/20 text-error"
                  }`}
                >
                  {confirmDelete ? "Confirm?" : "Delete"}
                </button>
              )}
            </div>
          )}

          {siblingComps.length > 1 && (
            <>
              <div className="border-t border-divider my-2" />
              <p className="text-micro text-ink-muted uppercase tracking-widest mb-1">Competitions</p>
              <div className="flex flex-col gap-1">
                {siblingComps.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => c.id !== comp.id && onNavigateComp(c.id)}
                    className={`py-2 px-3 rounded-md text-caption text-left flex items-center justify-between ${
                      c.id === comp.id
                        ? "bg-accent/20 text-accent font-semibold"
                        : "text-ink-secondary hover:bg-bg-surface"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className={`text-micro uppercase ml-2 ${
                      ["live", "countdown"].includes(c.state) ? "text-success" :
                      ["finished", "results"].includes(c.state) ? "text-ink-muted" : "text-ink-secondary"
                    }`}>
                      {c.state.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-divider my-2" />
          <button
            onClick={onBackToEvent}
            className="w-full py-2.5 px-3 rounded-md bg-bg-surface text-ink-secondary text-caption font-semibold text-left"
          >
            ← Back to Event
          </button>
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
              : p.competition_team_id
                ? "bg-accent/20 text-accent"
                : "bg-[#FFC857]/20 text-[#FFC857]"
          }`}
        >
          {p.status === "camera_ready" ? "Ready" : p.competition_team_id ? "Teamed" : "Joining…"}
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
  winnerCategories,
}: {
  participants: Participant[];
  teams: CompTeam[];
  repMap: Map<string, number>;
  teamSize: number;
  winnerCategories: string[];
}) {
  const isOlympics = winnerCategories.includes("highest_avg");

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

  const countryRanked = useMemo(() => {
    if (!isOlympics) return [];
    const byCountry = new Map<string, { code: string; name: string; total: number; count: number }>();
    for (const p of participants) {
      const code = p.nationality_code || "XX";
      const name = p.nationality_name || "Unknown";
      const reps = repMap.get(p.user_id) || 0;
      const entry = byCountry.get(code) || { code, name, total: 0, count: 0 };
      entry.total += reps;
      entry.count += 1;
      byCountry.set(code, entry);
    }
    return [...byCountry.values()].map((c) => ({
      ...c,
      avg: c.count > 0 ? c.total / c.count : 0,
    }));
  }, [participants, repMap, isOlympics]);

  const countryByTotal = useMemo(() =>
    [...countryRanked].sort((a, b) => b.total - a.total),
    [countryRanked]
  );
  const countryByAvg = useMemo(() =>
    [...countryRanked].sort((a, b) => b.avg - a.avg),
    [countryRanked]
  );

  const maxReps = individualRanked[0]?.reps || 1;
  const maxTeam = teamRanked[0]?.total || 1;

  return (
    <div className="w-[280px] flex-shrink-0 bg-bg-surface/50 border-l border-divider p-5 overflow-y-auto flex flex-col gap-6">
      {isOlympics && countryByTotal.length > 0 && (
        <>
          <div>
            <h3 className="text-micro text-accent uppercase tracking-widest mb-3">Most Reps by Country</h3>
            <div className="flex flex-col gap-2">
              {countryByTotal.map((c, i) => {
                const maxC = countryByTotal[0]?.total || 1;
                return (
                  <div key={c.code} className="flex items-center gap-2">
                    <span className={`text-[16px] font-bold w-6 text-right ${i < 3 ? "text-accent" : "text-ink-muted"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[15px] text-ink-primary truncate">
                          {c.code !== "XX" ? flagEmoji(c.code) + " " : ""}{c.name}
                        </span>
                        <span className="text-[15px] font-bold text-accent ml-2">{c.total}</span>
                      </div>
                      <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${(c.total / maxC) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h3 className="text-micro text-blue-400 uppercase tracking-widest mb-3">Highest Avg by Country</h3>
            <div className="flex flex-col gap-2">
              {countryByAvg.map((c, i) => {
                const maxA = countryByAvg[0]?.avg || 1;
                return (
                  <div key={c.code} className="flex items-center gap-2">
                    <span className={`text-[16px] font-bold w-6 text-right ${i < 3 ? "text-blue-400" : "text-ink-muted"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[15px] text-ink-primary truncate">
                          {c.code !== "XX" ? flagEmoji(c.code) + " " : ""}{c.name}
                        </span>
                        <span className="text-[15px] font-bold text-blue-400 ml-2">{c.avg.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${(c.avg / maxA) * 100}%` }} />
                      </div>
                      <span className="text-[11px] text-ink-muted">{c.count} {c.count === 1 ? "person" : "people"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

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

// ─── Medal Icon ─────────────────────────────────────────────────
function MedalIcon({ place, size = 48 }: { place: 1 | 2 | 3; size?: number }) {
  const colors = {
    1: { fill: "#FFD600", stroke: "#BFA100", ribbon: "#E8C200", label: "#7A6400" },
    2: { fill: "#C0C0C0", stroke: "#8E8E8E", ribbon: "#A8A8A8", label: "#5A5A5A" },
    3: { fill: "#CD7F32", stroke: "#8B5A1E", ribbon: "#B06C28", label: "#5C3310" },
  };
  const c = colors[place];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ribbon */}
      <path d="M17 4L24 18L31 4" stroke={c.ribbon} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      {/* Medal body */}
      <circle cx="24" cy="28" r="14" fill={c.fill} stroke={c.stroke} strokeWidth="2" />
      {/* Inner ring */}
      <circle cx="24" cy="28" r="10" fill="none" stroke={c.stroke} strokeWidth="1" opacity="0.4" />
      {/* Place number */}
      <text x="24" y="33" textAnchor="middle" fill={c.label} fontWeight="800" fontSize="14" fontFamily="Inter, system-ui, sans-serif">
        {place}
      </text>
    </svg>
  );
}

// ─── Results Overlay ─────────────────────────────────────────────
function ResultsOverlay({
  compName,
  participants,
  teams,
  repMap,
  totalReps,
  teamSize,
  eventId,
  siblingComps,
  currentCompId,
  winnerCategories,
  onNavigateComp,
  onDismiss,
  onShowAll,
}: {
  compName: string;
  participants: Participant[];
  teams: CompTeam[];
  repMap: Map<string, number>;
  totalReps: number;
  teamSize: number;
  eventId: string | null;
  siblingComps: { id: string; name: string; state: string }[];
  currentCompId: string;
  winnerCategories: string[];
  onNavigateComp: (id: string) => void;
  onDismiss: () => void;
  onShowAll: () => void;
}) {
  const isOlympics = winnerCategories.includes("highest_avg");

  const ranked = useMemo(() => {
    return [...participants]
      .map((p) => ({ ...p, reps: repMap.get(p.user_id) || 0 }))
      .sort((a, b) => b.reps - a.reps);
  }, [participants, repMap]);

  const rankedTeams = useMemo(() => {
    if (teamSize <= 1) return [];
    return teams
      .map((t) => {
        const members = participants.filter((p) => p.competition_team_id === t.id);
        const total = members.reduce((sum, m) => sum + (repMap.get(m.user_id) || 0), 0);
        return { ...t, total, members };
      })
      .sort((a, b) => b.total - a.total);
  }, [teams, participants, repMap, teamSize]);

  const countryResults = useMemo(() => {
    if (!isOlympics) return { byTotal: [], byAvg: [] };
    const byCountry = new Map<string, { code: string; name: string; total: number; count: number }>();
    for (const p of participants) {
      const code = p.nationality_code || "XX";
      const name = p.nationality_name || "Unknown";
      const reps = repMap.get(p.user_id) || 0;
      const entry = byCountry.get(code) || { code, name, total: 0, count: 0 };
      entry.total += reps;
      entry.count += 1;
      byCountry.set(code, entry);
    }
    const all = [...byCountry.values()].map((c) => ({ ...c, avg: c.count > 0 ? c.total / c.count : 0 }));
    return {
      byTotal: [...all].sort((a, b) => b.total - a.total),
      byAvg: [...all].sort((a, b) => b.avg - a.avg),
    };
  }, [participants, repMap, isOlympics]);

  const medalPlaces = [1, 2, 3] as const;

  const confettiRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const cancel = runConfetti(canvas, () => {}, "#FFD600");
    return cancel;
  }, []);

  return (
    <div className="fixed inset-0 z-30 bg-bg-base/90 backdrop-blur-sm flex items-center justify-center overflow-y-auto">
      <canvas ref={confettiRef} className="fixed inset-0 z-40 pointer-events-none" />
      <div className="text-center max-w-3xl py-10 px-4 w-full relative z-31">
        {/* Logo + comp name */}
        <img src="/Repps-Yellow-Logo.png" alt="REPPS" className="h-[86px] mx-auto mb-3 object-contain" />
        <p className="text-headline text-ink-primary font-bold uppercase tracking-wide mb-6">
          {compName} — {isOlympics ? "Olympics" : teamSize > 1 ? "Teams" : "Individual"}
        </p>

        {/* Total reps hero */}
        <p className="text-[72px] font-bold text-accent leading-none mb-1">{totalReps}</p>
        <p className="text-headline text-ink-secondary mb-10">total reps · {participants.length} participants</p>

        {/* Winners section */}
        {isOlympics ? (
          <div className="flex flex-col items-center gap-10 mb-8">
            <div>
              <p className="text-micro text-accent uppercase tracking-widest mb-5">Most Reps by Country</p>
              <div className="flex justify-center items-end gap-8">
                {[1, 0, 2].map((podiumIdx) => {
                  const c = countryResults.byTotal[podiumIdx];
                  if (!c) return null;
                  const isFirst = podiumIdx === 0;
                  return (
                    <div key={c.code} className={`text-center ${isFirst ? "scale-110" : ""}`}>
                      <div className="mb-1 flex justify-center"><MedalIcon place={medalPlaces[podiumIdx]} size={({ 1: 64, 2: 50, 3: 40 } as const)[medalPlaces[podiumIdx]]} /></div>
                      {c.code !== "XX" && <p className={`${isFirst ? "text-[48px]" : "text-[36px]"} leading-none mb-2`}>{flagEmoji(c.code)}</p>}
                      <p className={`${isFirst ? "text-body-lg" : "text-body"} text-ink-primary font-semibold`}>{c.name}</p>
                      <p className={`${isFirst ? "text-display-sm" : "text-headline"} text-accent font-bold`}>{c.total}</p>
                      <p className="text-caption text-ink-muted">{c.count} {c.count === 1 ? "person" : "people"}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="w-32 border-t border-divider" />

            <div>
              <p className="text-micro text-blue-400 uppercase tracking-widest mb-5">Highest Average by Country</p>
              <div className="flex justify-center items-end gap-8">
                {[1, 0, 2].map((podiumIdx) => {
                  const c = countryResults.byAvg[podiumIdx];
                  if (!c) return null;
                  const isFirst = podiumIdx === 0;
                  return (
                    <div key={c.code} className={`text-center ${isFirst ? "scale-110" : ""}`}>
                      <div className="mb-1 flex justify-center"><MedalIcon place={medalPlaces[podiumIdx]} size={({ 1: 64, 2: 50, 3: 40 } as const)[medalPlaces[podiumIdx]]} /></div>
                      {c.code !== "XX" && <p className={`${isFirst ? "text-[48px]" : "text-[36px]"} leading-none mb-2`}>{flagEmoji(c.code)}</p>}
                      <p className={`${isFirst ? "text-body-lg" : "text-body"} text-ink-primary font-semibold`}>{c.name}</p>
                      <p className={`${isFirst ? "text-display-sm" : "text-headline"} text-blue-400 font-bold`}>{c.avg.toFixed(1)}</p>
                      <p className="text-caption text-ink-muted">{c.count} {c.count === 1 ? "person" : "people"}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="w-32 border-t border-divider" />

            <div>
              <p className="text-micro text-ink-muted uppercase tracking-widest mb-5">Top Individuals</p>
              <div className="flex justify-center items-end gap-8">
                {[1, 0, 2].map((podiumIdx) => {
                  const p = ranked[podiumIdx];
                  if (!p) return null;
                  const isFirst = podiumIdx === 0;
                  return (
                    <div key={p.user_id} className={`text-center ${isFirst ? "scale-110" : ""}`}>
                      <div className="mb-2 flex justify-center"><MedalIcon place={medalPlaces[podiumIdx]} size={({ 1: 64, 2: 50, 3: 40 } as const)[medalPlaces[podiumIdx]]} /></div>
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className={`${isFirst ? "w-20 h-20" : "w-14 h-14"} rounded-full object-cover mx-auto mb-2`} />
                      ) : (
                        <div className={`${isFirst ? "w-20 h-20 text-headline" : "w-14 h-14 text-body-lg"} rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center font-bold mx-auto mb-2`}>
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className={`${isFirst ? "text-body-lg" : "text-body"} text-ink-primary font-semibold`}>{p.name}</p>
                      {p.nationality_code && (
                        <>
                          <p className={`${isFirst ? "text-[24px]" : "text-[20px]"} leading-none mt-1`}>{flagEmoji(p.nationality_code)}</p>
                          {p.nationality_name && <p className="text-caption text-ink-muted">{p.nationality_name}</p>}
                        </>
                      )}
                      <p className={`${isFirst ? "text-display-sm" : "text-headline"} text-accent font-bold`}>{p.reps}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : rankedTeams.length > 0 ? (
          <div className="flex justify-center items-end gap-10 mb-8">
            {[1, 0, 2].map((podiumIdx) => {
              const t = rankedTeams[podiumIdx];
              if (!t) return null;
              const isFirst = podiumIdx === 0;
              const initials = t.name.split(/[\s&]+/).filter((w: string) => w.length > 0).map((w: string) => w.charAt(0).toUpperCase()).join("").slice(0, 2);
              return (
                <div key={t.id} className={`text-center ${isFirst ? "scale-110" : ""}`}>
                  <div className="mb-2 flex justify-center"><MedalIcon place={medalPlaces[podiumIdx]} size={({ 1: 64, 2: 50, 3: 40 } as const)[medalPlaces[podiumIdx]]} /></div>
                  <div className={`${isFirst ? "w-20 h-20 text-headline" : "w-16 h-16 text-body-lg"} rounded-full bg-accent text-ink-inverse flex items-center justify-center font-bold mx-auto mb-2`}>
                    {initials}
                  </div>
                  <p className={`${isFirst ? "text-body-lg" : "text-body"} text-ink-primary font-semibold`}>{t.name}</p>
                  <p className={`${isFirst ? "text-display-sm" : "text-headline"} text-accent font-bold`}>{t.total} reps</p>
                  <p className="text-caption text-ink-muted">{t.members.length} members</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex justify-center items-end gap-10 mb-8">
            {[1, 0, 2].map((podiumIdx) => {
              const p = ranked[podiumIdx];
              if (!p) return null;
              const isFirst = podiumIdx === 0;
              return (
                <div key={p.user_id} className={`text-center ${isFirst ? "scale-110" : ""}`}>
                  <div className="mb-2 flex justify-center"><MedalIcon place={medalPlaces[podiumIdx]} size={({ 1: 64, 2: 50, 3: 40 } as const)[medalPlaces[podiumIdx]]} /></div>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className={`${isFirst ? "w-20 h-20" : "w-16 h-16"} rounded-full object-cover mx-auto mb-2`} />
                  ) : (
                    <div className={`${isFirst ? "w-20 h-20 text-headline" : "w-16 h-16 text-body-lg"} rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center font-bold mx-auto mb-2`}>
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p className={`${isFirst ? "text-body-lg" : "text-body"} text-ink-primary font-semibold`}>{p.name}</p>
                  {p.nationality_code && (
                    <>
                      <p className={`${isFirst ? "text-[28px]" : "text-[22px]"} leading-none mt-1`}>{flagEmoji(p.nationality_code)}</p>
                      {p.nationality_name && <p className="text-caption text-ink-muted">{p.nationality_name}</p>}
                    </>
                  )}
                  <p className={`${isFirst ? "text-display-sm" : "text-headline"} text-accent font-bold`}>{p.reps}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={onShowAll}
            className="py-3 px-8 rounded-pill bg-bg-surface text-ink-secondary text-body font-semibold active:scale-95 transition-transform"
          >
            View All Results
          </button>
        </div>

        {(() => {
          const others = siblingComps.filter((c) => c.id !== currentCompId);
          const next = others.find((c) => !["finished", "results"].includes(c.state));
          return (
            <div className="mt-4 flex flex-col items-center gap-3">
              {next && (
                <button
                  onClick={() => onNavigateComp(next.id)}
                  className="py-3 px-8 rounded-pill bg-accent text-ink-inverse text-body font-semibold active:scale-95 transition-transform"
                >
                  Next: {next.name}
                </button>
              )}
              <button
                onClick={onDismiss}
                className={`py-3 px-8 rounded-pill text-body font-semibold active:scale-95 transition-transform ${
                  next ? "bg-bg-surface text-ink-secondary" : "bg-accent text-ink-inverse"
                }`}
              >
                {eventId ? "Back to Event" : "Done"}
              </button>
            </div>
          );
        })()}
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
  const [siblingComps, setSiblingComps] = useState<{ id: string; name: string; state: string }[]>([]);
  const [showResultsOverlay, setShowResultsOverlay] = useState(true);
  const repMapRef = useRef(repMap);
  repMapRef.current = repMap;
  const hasAutoShownResults = useRef(false);

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
    if (data.teams?.length > 0) {
      console.log("[COMP] teams:", data.teams, "participants team_ids:", data.participants?.map((p: any) => ({ name: p.name, team_id: p.competition_team_id })));
    }
    setTotalReps(data.total_qualified_reps);

    const map = new Map<string, number>();
    for (const r of data.reps) {
      map.set(r.user_id, r.qualified_reps);
    }
    setRepMap(map);

    if (data.competition.state === "countdown") {
      setShowCountdown(true);
    }

    if ((data.competition.state === "finished" || data.competition.state === "results") && !hasAutoShownResults.current) {
      hasAutoShownResults.current = true;
      setShowResultsOverlay(true);
    }

    if (data.event?.id) {
      const { data: siblings } = await supabase
        .from("competition_settings")
        .select("id, name, state")
        .eq("event_id", data.event.id)
        .order("created_at", { ascending: true });
      if (siblings) setSiblingComps(siblings);
    }

    setLoading(false);
  }, [competitionId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Poll fallback — Realtime can be unreliable, poll every 3s when pre-live
  useEffect(() => {
    if (!competitionId) return;
    const id = setInterval(loadDashboard, 3000);
    return () => clearInterval(id);
  }, [competitionId, loadDashboard]);

  // Generate QR code for join
  useEffect(() => {
    if (!comp?.join_code) return;
    const url = `${window.location.origin}/compete/${comp.join_code}`;
    generateStyledQRDataUrl(url, 400).then(setQrUrl);
  }, [comp?.join_code]);

  // Realtime: participant changes (unfiltered — filtered UPDATEs unreliable even with replica identity full)
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
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (row && row.competition_id && row.competition_id !== competitionId) return;
          console.log("[COMP] participant change:", payload.eventType, row?.status);
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
          if (newState.state === "finished" || newState.state === "results") setShowResultsOverlay(true);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId]);

  // Realtime: sibling competition changes (new competitions created, state changes)
  useEffect(() => {
    if (!event?.id) return;
    const channel = supabase
      .channel(`comp-siblings-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_settings",
          filter: `event_id=eq.${event.id}`,
        },
        async () => {
          const { data: siblings } = await supabase
            .from("competition_settings")
            .select("id, name, state")
            .eq("event_id", event.id)
            .order("created_at", { ascending: true });
          if (siblings) setSiblingComps(siblings);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [event?.id]);

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

  const mainTeamRanked = useMemo(() => {
    if (!comp || comp.team_size <= 1) return [];
    return teams
      .map((t) => {
        const members = participants.filter((p) => p.competition_team_id === t.id);
        const total = members.reduce((sum, m) => sum + (repMap.get(m.user_id) || 0), 0);
        return { ...t, total, members };
      })
      .sort((a, b) => b.total - a.total);
  }, [comp, teams, participants, repMap]);

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
  const myReps = profile ? repMap.get(profile.id) || 0 : 0;
  const myRank = profile ? rankOf(profile.id) : null;

  const readyCount = participants.filter((p) => p.status === "camera_ready" || p.status === "live").length;
  const myStatus = profile ? participants.find((p) => p.user_id === profile.id)?.status : null;

  // ─── Participant mobile view ─────────────────────────────────
  if (isParticipant && !isOrganizer) {
    return (
      <div className="fixed inset-0 bg-bg-base text-ink-primary flex flex-col">
        {showCountdown && <CountdownOverlay onComplete={handleCountdownComplete} />}

        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
          <h1 className="text-display-md mb-2">{comp.name}</h1>

          {isPreLobby && myStatus === "joined" && (
            <>
              <p className="text-body-lg text-ink-secondary mb-2">
                Set up your camera so you're ready when it's go time.
              </p>
              <p className="text-body text-ink-muted mb-6">
                {readyCount} of {participants.length} ready
              </p>
              <button
                onClick={() => navigate(`/dab?comp=${comp.id}`)}
                className="w-full max-w-xs py-5 rounded-xl bg-accent text-ink-inverse text-headline font-bold active:scale-95 transition-transform"
              >
                Get Ready
              </button>
            </>
          )}

          {isPreLobby && myStatus === "camera_ready" && (
            <>
              <p className="text-body-lg text-success font-semibold mb-2">
                You're ready!
              </p>
              <p className="text-body text-ink-secondary mb-4">
                Waiting for the organizer to start the competition…
              </p>
              <p className="text-body text-ink-muted">
                {readyCount} of {participants.length} ready
              </p>
            </>
          )}

          {isLive && (
            <>
              <div className="mb-4">
                <span className="flex items-center justify-center gap-2 text-body font-semibold text-error mb-4">
                  <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
                  LIVE
                </span>
                <span className="text-[40px] block">
                  <Timer comp={comp} />
                </span>
              </div>
              <p className="text-[64px] font-bold text-accent leading-none mb-1">{myReps}</p>
              <p className="text-body text-ink-muted mb-2">your reps</p>
              {myRank && (
                <p className="text-headline text-ink-secondary mb-6">
                  #{myRank} of {participants.length}
                </p>
              )}
            </>
          )}

          {isFinished && (
            <>
              <p className="text-headline text-ink-secondary mb-4">Competition Complete!</p>
              <p className="text-[64px] font-bold text-accent leading-none mb-1">{myReps}</p>
              <p className="text-body text-ink-muted mb-2">your reps</p>
              {mainTeamRanked.length > 0 ? (() => {
                const myTeamEntry = mainTeamRanked.find((t) => t.members.some((m) => m.user_id === profile?.id));
                const myTeamRank = myTeamEntry ? mainTeamRanked.indexOf(myTeamEntry) + 1 : null;
                return myTeamEntry ? (
                  <div className="mb-6">
                    <p className="text-body-lg text-ink-primary font-semibold">{myTeamEntry.name}</p>
                    <p className="text-headline text-ink-secondary">
                      #{myTeamRank} of {mainTeamRanked.length} teams · {myTeamEntry.total} team reps
                    </p>
                  </div>
                ) : null;
              })() : myRank && (
                <p className="text-headline text-ink-secondary mb-6">
                  #{myRank} of {participants.length}
                </p>
              )}

              <div className="w-full max-w-xs">
                {mainTeamRanked.length > 0 ? (
                  <>
                    <p className="text-micro text-ink-muted uppercase tracking-widest mb-3 text-left">Team Rankings</p>
                    <div className="flex flex-col gap-1.5">
                      {mainTeamRanked.map((t, i) => {
                        const myTeam = t.members.some((m) => m.user_id === profile?.id);
                        const initials = t.name.split(/[\s&]+/).filter((w: string) => w.length > 0).map((w: string) => w.charAt(0).toUpperCase()).join("").slice(0, 2);
                        return (
                          <div
                            key={t.id}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                              myTeam ? "bg-accent/15 ring-1 ring-accent/30" : "bg-bg-surface"
                            }`}
                          >
                            <span className={`text-body font-bold w-6 text-right ${i < 3 ? "text-accent" : "text-ink-muted"}`}>
                              {i + 1}
                            </span>
                            <div className="w-8 h-8 rounded-full bg-accent text-ink-inverse flex items-center justify-center text-caption font-bold">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <p className={`text-body truncate ${myTeam ? "text-accent font-semibold" : "text-ink-primary"}`}>
                                {t.name}{myTeam ? " (you)" : ""}
                              </p>
                            </div>
                            <span className={`text-body font-bold tabular-nums ${myTeam ? "text-accent" : "text-ink-primary"}`}>
                              {t.total}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-micro text-ink-muted uppercase tracking-widest mb-3 text-left">Leaderboard</p>
                    <div className="flex flex-col gap-1.5">
                      {ranked.map((p, i) => {
                        const isMe = p.user_id === profile?.id;
                        const reps = repMap.get(p.user_id) || 0;
                        const flag = p.nationality_code ? flagEmoji(p.nationality_code) : "";
                        return (
                          <div
                            key={p.user_id}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                              isMe ? "bg-accent/15 ring-1 ring-accent/30" : "bg-bg-surface"
                            }`}
                          >
                            <span className={`text-body font-bold w-6 text-right ${i < 3 ? "text-accent" : "text-ink-muted"}`}>
                              {i + 1}
                            </span>
                            {p.avatar_url ? (
                              <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-caption font-bold">
                                {p.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0 text-left">
                              <p className={`text-body truncate ${isMe ? "text-accent font-semibold" : "text-ink-primary"}`}>
                                {flag && <span className="mr-1">{flag}</span>}
                                {p.name}{isMe ? " (you)" : ""}
                              </p>
                            </div>
                            <span className={`text-body font-bold tabular-nums ${isMe ? "text-accent" : "text-ink-primary"}`}>
                              {reps}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <p className="text-display-md text-ink-primary mt-6">{animatedTotal}</p>
              <p className="text-body text-ink-muted mb-6">total competition reps</p>
              <button
                onClick={() => event?.id ? navigate(`/events/${event.id}`) : navigate("/")}
                className="py-3 px-8 rounded-pill bg-accent text-ink-inverse text-body font-semibold active:scale-95 transition-transform"
              >
                {event?.id ? "Back to Event" : "Done"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Spectator / organizer dashboard ─────────────────────────
  return (
    <div className="fixed inset-0 bg-bg-base text-ink-primary overflow-hidden flex flex-col select-none">
      {/* Header */}
      <header className="h-20 flex items-center px-6 border-b border-divider flex-shrink-0">
        <div className="flex-1 flex items-center gap-4">
          {isLive && (
            <span className="flex items-center gap-2 text-[18px] font-semibold">
              <span className="w-3 h-3 rounded-full bg-error animate-pulse" />
              LIVE
            </span>
          )}
          {isFinished && (
            <span className="flex items-center gap-2 text-[18px] font-semibold text-accent">
              COMPLETE
            </span>
          )}
          <span className="text-[48px] font-bold text-accent leading-none tabular-nums">
            {animatedTotal}
          </span>
          <span className="text-[40px]">
            <Timer comp={comp} />
          </span>
        </div>
        <div className="text-center flex-shrink-0 flex flex-col items-center">
          <img src="/Repps-Yellow-Logo.png" alt="REPPS" className="h-16 object-contain mb-0.5" />
          <p className="text-[20px] text-white font-bold truncate max-w-[500px]">
            {comp.name} — {(comp.winner_categories || []).includes("highest_avg") ? "Olympics" : comp.team_size > 1 ? "Teams" : "Individual"}
          </p>
        </div>
        <div className="flex-1 flex items-center justify-end gap-4">
          {isFinished && (
            <button
              onClick={() => setShowResultsOverlay(!showResultsOverlay)}
              className="py-2 px-5 rounded-pill bg-accent/15 text-accent text-caption font-semibold active:scale-95 transition-transform"
            >
              {showResultsOverlay ? "View Board" : "Show Winners"}
            </button>
          )}
          <p className="text-[15px] text-ink-muted">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </p>
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
                <div className="mb-4 bg-white p-4 rounded-xl inline-block">
                  <img src={qrUrl} alt="Join QR" className="w-[400px] h-[400px]" />
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
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {teams.map((team) => {
                const members = participants.filter(
                  (p) => p.competition_team_id === team.id
                );
                const teamTotal = members.reduce(
                  (s, m) => s + (repMap.get(m.user_id) || 0),
                  0
                );
                return (
                  <div key={team.id} className="bg-bg-surface border border-divider rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-micro text-accent uppercase tracking-widest font-bold bg-accent/10 px-2 py-0.5 rounded-full shrink-0">Team</span>
                        <h2 className="text-body-lg font-bold text-ink-primary truncate">{team.name}</h2>
                      </div>
                      {isLive && (
                        <span className="text-body-lg font-bold text-accent whitespace-nowrap ml-2">
                          {teamTotal}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 flex-wrap flex-1">
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
              {(() => {
                const solos = participants.filter((p) => !p.competition_team_id);
                if (solos.length === 0) return null;
                return solos.map((p) => (
                  <div key={p.user_id} className="bg-bg-elevated/50 border border-divider rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-micro text-ink-muted uppercase tracking-widest font-bold bg-ink-muted/10 px-2 py-0.5 rounded-full">Solo</span>
                    </div>
                    <ParticipantCard
                      p={p}
                      reps={repMap.get(p.user_id) || 0}
                      rank={rankOf(p.user_id)}
                      live={isLive || isFinished}
                    />
                  </div>
                ));
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

          {/* Ready progress */}
          {isPreLobby && participants.length > 0 && (
            <div className="flex flex-col items-center mt-6 gap-2">
              <p className="text-body text-ink-secondary">
                <span className="text-accent font-bold">{readyCount}</span> of{" "}
                <span className="font-semibold">{participants.length}</span> ready
              </p>
              <div className="w-64 h-2 bg-bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all duration-500 ease-apple"
                  style={{ width: `${participants.length > 0 ? (readyCount / participants.length) * 100 : 0}%` }}
                />
              </div>
              {readyCount === participants.length && participants.length > 0 && (
                <p className="text-success text-caption font-semibold mt-1">All participants ready!</p>
              )}
            </div>
          )}

        </div>

        {(isLive || isFinished) && (
          <Sidebar
            participants={participants}
            teams={teams}
            repMap={repMap}
            teamSize={comp.team_size}
            winnerCategories={comp.winner_categories || ["overall"]}
          />
        )}
      </div>

      {showCountdown && <CountdownOverlay onComplete={handleCountdownComplete} />}
      {isFinished && showResultsOverlay && (
        <ResultsOverlay
          compName={comp.name}
          participants={participants}
          teams={teams}
          repMap={repMap}
          totalReps={totalReps}
          teamSize={comp.team_size}
          eventId={event?.id || null}
          siblingComps={siblingComps}
          currentCompId={comp.id}
          winnerCategories={comp.winner_categories || ["overall"]}
          onNavigateComp={(id) => navigate(`/live/${id}`)}
          onDismiss={() => {
            if (event?.id) {
              navigate(`/events/${event.id}`);
            } else {
              navigate("/");
            }
          }}
          onShowAll={() => setShowResultsOverlay(false)}
        />
      )}
      {isOrganizer && (
        <AdminOverlay
          comp={comp}
          siblingComps={siblingComps}
          onTransition={handleTransition}
          onNavigateComp={(id) => navigate(`/live/${id}`)}
          onRename={async (name) => {
            const { data } = await supabase.rpc("rename_competition", {
              p_competition_id: comp.id,
              p_name: name,
            });
            if (data?.success) {
              setComp((prev) => prev ? { ...prev, name } : prev);
            }
          }}
          onDelete={async () => {
            const { data } = await supabase.rpc("delete_competition", {
              p_competition_id: comp.id,
            });
            if (data?.success) {
              const eventId = event?.id;
              if (eventId) navigate(`/events/${eventId}`);
              else navigate("/");
            }
          }}
          onBackToEvent={() => {
            if (event?.id) navigate(`/events/${event.id}`);
            else navigate("/");
          }}
        />
      )}
    </div>
  );
}
