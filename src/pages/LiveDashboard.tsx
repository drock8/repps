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
}: {
  comp: CompState;
  siblingComps: { id: string; name: string; state: string }[];
  onTransition: (state: string) => void;
  onNavigateComp: (id: string) => void;
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

// ─── Finish Overlay ──────────────────────────────────────────────
function FinishOverlay({
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
}: {
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
}) {
  const isOlympics = winnerCategories.includes("highest_avg");

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

  return (
    <div className="fixed inset-0 z-30 bg-bg-base/85 flex items-center justify-center overflow-y-auto">
      <div className="text-center max-w-2xl py-10">
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

        {isOlympics ? (
          <div className="flex flex-col items-center gap-12 mb-8">
            <div>
              <p className="text-micro text-accent uppercase tracking-widest mb-4">Most Reps by Country</p>
              <div className="flex justify-center gap-6">
                {countryResults.byTotal.slice(0, 3).map((c, i) => (
                  <div key={c.code} className="text-center">
                    <p className="text-[32px] mb-1">{["🥇", "🥈", "🥉"][i]}</p>
                    {c.code !== "XX" && <p className="text-[32px] leading-none mb-1">{flagEmoji(c.code)}</p>}
                    <p className="text-body-lg text-ink-primary font-semibold">{c.name}</p>
                    <p className="text-headline text-accent">{c.total}</p>
                    <p className="text-caption text-ink-muted">{c.count} {c.count === 1 ? "person" : "people"}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-32 border-t border-divider" />

            <div>
              <p className="text-micro text-blue-400 uppercase tracking-widest mb-4">Highest Average by Country</p>
              <div className="flex justify-center gap-6">
                {countryResults.byAvg.slice(0, 3).map((c, i) => (
                  <div key={c.code} className="text-center">
                    <p className="text-[32px] mb-1">{["🥇", "🥈", "🥉"][i]}</p>
                    {c.code !== "XX" && <p className="text-[32px] leading-none mb-1">{flagEmoji(c.code)}</p>}
                    <p className="text-body-lg text-ink-primary font-semibold">{c.name}</p>
                    <p className="text-headline text-blue-400">{c.avg.toFixed(1)}</p>
                    <p className="text-caption text-ink-muted">{c.count} {c.count === 1 ? "person" : "people"}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
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
        )}

        {isOlympics && (
          <>
            <div className="w-32 border-t border-divider mx-auto my-8" />
            <div>
              <p className="text-micro text-ink-muted uppercase tracking-widest mb-4">Top Individuals</p>
              <div className="flex justify-center gap-8">
                {ranked.slice(0, 3).map((p, i) => (
                  <div key={p.user_id} className="text-center">
                    <p className="text-[24px] mb-1">{["🥇", "🥈", "🥉"][i]}</p>
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover mx-auto mb-1" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold mx-auto mb-1">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <p className="text-body text-ink-primary font-semibold">{p.name}</p>
                    <p className="text-body text-accent">{p.reps}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-32 border-t border-divider mx-auto my-8" />
            <div>
              <p className="text-micro text-ink-muted uppercase tracking-widest mb-3">All Countries</p>
              <div className="flex flex-wrap justify-center gap-4">
                {countryResults.byTotal.map((c, i) => (
                  <div key={c.code} className="text-center min-w-[80px]">
                    <p className="text-[14px] font-bold text-ink-muted">{i + 1}</p>
                    {c.code !== "XX" && <p className="text-[24px] leading-none">{flagEmoji(c.code)}</p>}
                    <p className="text-caption text-ink-primary font-semibold">{c.name}</p>
                    <p className="text-caption text-accent">{c.total} reps</p>
                    <p className="text-micro text-ink-muted">avg {c.avg.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {(() => {
          const others = siblingComps.filter((c) => c.id !== currentCompId);
          const next = others.find((c) => !["finished", "results"].includes(c.state));
          return (
            <div className="mt-10 flex flex-col items-center gap-3">
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
              {myRank && (
                <p className="text-headline text-ink-secondary mb-6">
                  #{myRank} of {participants.length}
                </p>
              )}

              <div className="w-full max-w-xs">
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
            <div className="flex flex-wrap gap-4 justify-center">
              {teams.map((team) => {
                const members = participants.filter(
                  (p) => p.competition_team_id === team.id
                );
                const teamTotal = members.reduce(
                  (s, m) => s + (repMap.get(m.user_id) || 0),
                  0
                );
                return (
                  <div key={team.id} className="bg-bg-surface border border-divider rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-micro text-accent uppercase tracking-widest font-bold bg-accent/10 px-2 py-0.5 rounded-full">Team</span>
                        <h2 className="text-body-lg font-bold text-ink-primary truncate">{team.name}</h2>
                      </div>
                      {isLive && (
                        <span className="text-body-lg font-bold text-accent whitespace-nowrap ml-2">
                          {teamTotal}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 flex-wrap">
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

          {(isLive || isFinished) && (
            <p className="text-center text-ink-secondary text-body mt-6">
              {participants.length} participant{participants.length !== 1 ? "s" : ""}
            </p>
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
      {isFinished && (
        <FinishOverlay
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
        />
      )}
      {isOrganizer && (
        <AdminOverlay
          comp={comp}
          siblingComps={siblingComps}
          onTransition={handleTransition}
          onNavigateComp={(id) => navigate(`/live/${id}`)}
        />
      )}
    </div>
  );
}
