import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { generateStyledQRDataUrl } from "../lib/qrRenderer";
import ProfileGate from "../components/ProfileGate";
import QRScanner from "../components/QRScanner";

interface CompInfo {
  id: string;
  name: string;
  state: string;
  team_size: number;
  duration_seconds: number | null;
  target_type: string;
  join_code: string;
}

interface TeamMember {
  user_id: string;
  name: string;
  avatar_url: string | null;
}

interface TeamInfo {
  id: string;
  name: string;
  members: TeamMember[];
}

interface Inviter {
  id: string;
  name: string;
  avatar_url: string | null;
}

export default function CompetitionJoin() {
  const { joinCode } = useParams<{ joinCode: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [comp, setComp] = useState<CompInfo | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [showProfileGate, setShowProfileGate] = useState(false);

  // All participant state — driven by a single poll
  const [joined, setJoined] = useState(false);
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [inviteFrom, setInviteFrom] = useState<Inviter | null>(null);

  // UI-only state
  const [scanning, setScanning] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [myQrUrl, setMyQrUrl] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);

  const compRef = useRef(comp);
  compRef.current = comp;

  // ─── Load competition (once) ──────────────────────────────────
  useEffect(() => {
    if (!joinCode) return;
    (async () => {
      const { data: c } = await supabase
        .from("competition_settings")
        .select("id, name, state, team_size, duration_seconds, target_type, join_code")
        .eq("join_code", joinCode.toUpperCase())
        .single();
      if (!c) { setError("Competition not found"); setLoading(false); return; }

      const { count } = await supabase
        .from("competition_participants")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", c.id)
        .neq("status", "withdrawn");

      setComp(c);
      setParticipantCount(count || 0);
      setLoading(false);
    })();
  }, [joinCode]);

  // ─── Single poll: reads ALL participant state ─────────────────
  // This is the only thing that drives joined/team/inviteFrom state.
  // Everything else (accept, scan, join) just writes to the DB and
  // lets this poll pick up the result within 2 seconds.
  useEffect(() => {
    if (!profile || !comp) return;

    const poll = async () => {
      // 1. Am I a participant?
      const { data: me } = await supabase
        .from("competition_participants")
        .select("id, competition_team_id, team_invite_from")
        .eq("competition_id", comp.id)
        .eq("user_id", profile.id)
        .neq("status", "withdrawn")
        .maybeSingle();

      if (!me) { setJoined(false); return; }
      setJoined(true);

      // 2. Am I on a team?
      if (me.competition_team_id) {
        // Load team name
        const { data: teamRow } = await supabase
          .from("competition_teams")
          .select("id, name")
          .eq("id", me.competition_team_id)
          .single();

        // Load team members
        const { data: memberRows } = await supabase
          .from("competition_participants")
          .select("user_id")
          .eq("competition_team_id", me.competition_team_id)
          .neq("status", "withdrawn");

        if (teamRow && memberRows && memberRows.length > 0) {
          const userIds = memberRows.map((m) => m.user_id);
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, name, avatar_url")
            .in("id", userIds);

          const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
          const members: TeamMember[] = memberRows.map((m) => {
            const p = profileMap.get(m.user_id);
            return { user_id: m.user_id, name: p?.name || "?", avatar_url: p?.avatar_url || null };
          });

          setTeam({ id: teamRow.id, name: teamRow.name, members });
        }
        setInviteFrom(null);
        return;
      }

      // 3. Do I have a pending invite?
      if (me.team_invite_from) {
        const { data: inviter } = await supabase
          .from("profiles")
          .select("id, name, avatar_url")
          .eq("id", me.team_invite_from)
          .single();
        if (inviter) setInviteFrom(inviter);
      } else {
        setInviteFrom(null);
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [profile, comp]);

  // ─── Generate QR (derived from state) ─────────────────────────
  useEffect(() => {
    if (!profile || !comp || !joined || comp.team_size <= 1) return;
    if (team && team.members.length >= comp.team_size) { setMyQrUrl(null); return; }
    const url = `${window.location.origin}/compete/${comp.join_code}?pair=${profile.id}`;
    generateStyledQRDataUrl(url, 200).then(setMyQrUrl);
  }, [profile, comp, joined, team]);

  // ─── Actions (write to DB only — poll picks up the result) ────

  function handleJoinClick() {
    if (!profile || !comp) return;
    if (!profile.dob || !profile.nationality_code) { setShowProfileGate(true); return; }
    doJoin();
  }

  async function doJoin() {
    if (!profile || !comp) return;
    setJoining(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc("enter_competition", {
      p_join_code: comp.join_code,
      p_entry_type: "individual",
      p_team_name: null,
    });
    if (rpcErr || !data?.success) {
      if (data?.error === "already_joined") { setJoined(true); setJoining(false); return; }
      setError(rpcErr?.message || data?.message || data?.error || "Failed to join");
      setJoining(false);
      return;
    }
    setJoined(true);
    setParticipantCount((c) => c + 1);
    setJoining(false);
  }

  const handleScanResult = useCallback(async (value: string) => {
    setScanning(false);
    const c = compRef.current;
    if (!c || !profile) return;

    const pairMatch = value.match(/[?&]pair=([a-f0-9-]+)/i);
    if (!pairMatch) { setError("Not a valid teammate QR code"); return; }
    const targetUserId = pairMatch[1];
    if (targetUserId === profile.id) { setError("That's your own QR code!"); return; }

    setError("");
    const { data, error: rpcErr } = await supabase.rpc("send_team_invite", {
      p_competition_id: c.id,
      p_target_user_id: targetUserId,
    });
    if (rpcErr || !data?.success) {
      const errCode = data?.error;
      const messages: Record<string, string> = {
        target_not_participant: "They haven't joined yet",
        target_already_on_team: "They're already on a team",
        target_has_pending_invite: "They have a pending invite",
        team_full: "Your team is full",
        cannot_invite_self: "That's your own QR code!",
      };
      setError(messages[errCode] || rpcErr?.message || errCode || "Failed to send invite");
      return;
    }
    setInviteSent(true);
    setTimeout(() => setInviteSent(false), 5000);
  }, [profile]);

  async function handleRespondInvite(accept: boolean) {
    if (!comp) return;
    setResponding(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("respond_team_invite", {
      p_competition_id: comp.id,
      p_accept: accept,
    });
    if (rpcErr) setError(rpcErr.message);
    setInviteFrom(null);
    setResponding(false);
    // Poll will pick up the team formation within 2s
  }

  async function handleSaveTeamName() {
    if (!comp || !team) return;
    const trimmed = teamNameInput.trim();
    if (!trimmed) return;
    setSavingName(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc("rename_competition_team", {
      p_competition_id: comp.id,
      p_team_name: trimmed,
    });
    if (rpcErr || !data?.success) {
      const errCode = data?.error;
      const messages: Record<string, string> = {
        invalid_name: "Name must be 1–40 characters",
        not_on_team: "You're not on a team",
        name_taken: "That name is already taken",
      };
      setError(messages[errCode] || rpcErr?.message || errCode || "Failed to save name");
      setSavingName(false);
      return;
    }
    setTeam((prev) => prev ? { ...prev, name: data.name } : prev);
    setNameConfirmed(true);
    setSavingName(false);
  }

  // ─── Render ───────────────────────────────────────────────────

  if (scanning) {
    return <QRScanner onScan={handleScanResult} onClose={() => setScanning(false)} />;
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
        <button onClick={() => navigate("/events")} className="mt-4 text-accent text-body font-semibold">
          Browse Events
        </button>
      </div>
    );
  }

  const joinable = comp.state === "join_open" || comp.state === "join_closed";
  const isTeamComp = comp.team_size > 1;
  const teamIsFull = team ? team.members.length >= comp.team_size : false;
  const durationLabel = comp.duration_seconds
    ? comp.duration_seconds >= 60
      ? `${Math.floor(comp.duration_seconds / 60)} min`
      : `${comp.duration_seconds}s`
    : "Target-based";

  // ─── Not joined yet ───────────────────────────────────────────
  if (!joined) {
    if (!joinable) {
      return (
        <div className="px-5 pt-6 max-w-md mx-auto text-center">
          <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
          <h1 className="text-display-md text-ink-primary mb-2">{comp.name}</h1>
          <p className="text-body text-ink-secondary mb-4">
            {comp.state === "draft" || comp.state === "announced"
              ? "Entries aren't open yet. Watch the big screen!"
              : "This competition is underway."}
          </p>
          <button onClick={() => navigate(`/live/${comp.id}`)} className="w-full py-4 rounded-lg bg-bg-surface text-ink-primary text-body-lg font-semibold">
            Watch Live
          </button>
        </div>
      );
    }

    return (
      <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-2">{comp.name}</h1>
        <div className="flex items-center justify-center gap-4 text-body text-ink-secondary mb-8">
          <span>{durationLabel}</span>
          <span>·</span>
          <span>{isTeamComp ? `Teams of ${comp.team_size}` : "Individual"}</span>
          <span>·</span>
          <span>{participantCount} joined</span>
        </div>
        {error && <p className="text-error text-caption mb-4">{error}</p>}
        <button
          onClick={handleJoinClick}
          disabled={joining}
          className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold disabled:opacity-40 transition-opacity"
        >
          {joining ? "Joining…" : "Join Competition"}
        </button>
        {showProfileGate && (
          <ProfileGate
            onComplete={() => { setShowProfileGate(false); doJoin(); }}
            onSkip={() => { setShowProfileGate(false); doJoin(); }}
          />
        )}
      </div>
    );
  }

  // ─── Joined: solo comp → straight to Get Ready ────────────────
  if (!isTeamComp) {
    return (
      <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-2">{comp.name}</h1>
        <p className="text-body-lg text-success font-semibold mb-6">You're in!</p>
        <button onClick={() => navigate(`/dab?comp=${comp.id}`)} className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3">
          Get Ready
        </button>
        <button onClick={() => navigate(`/live/${comp.id}`)} className="w-full py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold">
          Watch Dashboard
        </button>
      </div>
    );
  }

  // ─── Joined team comp: team full + named → Get Ready ──────────
  if (team && teamIsFull && nameConfirmed) {
    return (
      <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-4">{comp.name}</h1>
        <div className="bg-success/10 rounded-xl p-5 mb-6">
          <p className="text-micro text-success uppercase tracking-widest font-bold mb-3">Team Ready</p>
          <p className="text-headline text-ink-primary font-semibold mb-4">{team.name}</p>
          <div className="flex justify-center gap-4 flex-wrap">
            {team.members.map((m) => (
              <div key={m.user_id} className="flex flex-col items-center gap-1">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-caption text-ink-primary font-semibold">{m.name}</p>
              </div>
            ))}
          </div>
        </div>
        <button onClick={() => navigate(`/dab?comp=${comp.id}`)} className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3">
          Get Ready
        </button>
        <button onClick={() => navigate(`/live/${comp.id}`)} className="w-full py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold">
          Watch Dashboard
        </button>
      </div>
    );
  }

  // ─── Joined team comp: team full → name it ────────────────────
  if (team && teamIsFull) {
    return (
      <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-4">{comp.name}</h1>
        <div className="bg-success/10 rounded-xl p-5 mb-6">
          <p className="text-micro text-success uppercase tracking-widest font-bold mb-3">Team Complete</p>
          <div className="flex justify-center gap-4 flex-wrap">
            {team.members.map((m) => (
              <div key={m.user_id} className="flex flex-col items-center gap-1">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-caption text-ink-primary font-semibold">{m.name}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-body text-ink-secondary mb-3">Name your team</p>
        <input
          type="text"
          value={teamNameInput}
          onChange={(e) => setTeamNameInput(e.target.value)}
          placeholder={team.name}
          maxLength={40}
          className="w-full px-4 py-3 rounded-lg bg-bg-surface text-ink-primary text-body-lg text-center placeholder:text-ink-muted/50 border border-divider focus:border-accent focus:outline-none transition-colors"
          onKeyDown={(e) => { if (e.key === "Enter") handleSaveTeamName(); }}
          autoFocus
        />
        <div className="flex gap-3 mt-3">
          <button onClick={() => setNameConfirmed(true)} className="flex-1 py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold">
            Keep It
          </button>
          <button
            onClick={handleSaveTeamName}
            disabled={savingName || !teamNameInput.trim()}
            className="flex-1 py-3 rounded-lg bg-accent text-ink-inverse text-body font-semibold disabled:opacity-40"
          >
            {savingName ? "Saving…" : "Save"}
          </button>
        </div>
        {error && <p className="text-error text-caption mt-3">{error}</p>}
      </div>
    );
  }

  // ─── Joined team comp: team forming (not full) ────────────────
  if (team && !teamIsFull) {
    return (
      <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-4">{comp.name}</h1>
        <div className="bg-accent/10 rounded-xl p-5 mb-5">
          <p className="text-micro text-accent uppercase tracking-widest font-bold mb-3">
            {team.members.length} of {comp.team_size} teammates
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            {team.members.map((m) => (
              <div key={m.user_id} className="flex flex-col items-center gap-1">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-caption text-ink-primary font-semibold">{m.name}</p>
              </div>
            ))}
            {Array.from({ length: comp.team_size - team.members.length }).map((_, i) => (
              <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full border-2 border-dashed border-ink-muted/40 flex items-center justify-center">
                  <span className="text-ink-muted text-body-lg">?</span>
                </div>
                <p className="text-caption text-ink-muted">Open</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-body text-ink-secondary mb-3">Scan a teammate's code to add them.</p>
        {myQrUrl && (
          <div className="bg-bg-surface rounded-xl p-4 mb-4 inline-block">
            <img src={myQrUrl} width={160} height={160} alt="Your team QR" className="rounded-lg mx-auto mb-1" />
            <p className="text-caption text-ink-muted">Your QR code</p>
          </div>
        )}
        <button
          onClick={() => setScanning(true)}
          className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3 flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan to Add Teammate
        </button>
        {inviteSent && <p className="text-success text-body font-semibold mb-3">Invite sent!</p>}
        {error && <p className="text-error text-caption mt-3">{error}</p>}
      </div>
    );
  }

  // ─── Joined team comp: no team yet → Find Teammate ────────────
  return (
    <div className="px-5 pt-6 pb-28 max-w-md mx-auto text-center">
      <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
      <h1 className="text-display-md text-ink-primary mb-4">{comp.name}</h1>

      <div className="bg-success/10 rounded-xl p-4 mb-5">
        <p className="text-success text-body-lg font-semibold">You're in!</p>
      </div>

      {inviteFrom && (
        <div className="bg-accent/10 rounded-xl p-5 mb-5">
          <p className="text-micro text-accent uppercase tracking-widest font-bold mb-3">Team Request</p>
          <div className="flex items-center justify-center gap-3 mb-3">
            {inviteFrom.avatar_url ? (
              <img src={inviteFrom.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold">
                {inviteFrom.name.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="text-body-lg text-ink-primary font-semibold">{inviteFrom.name}</p>
          </div>
          <p className="text-body text-ink-secondary mb-4">wants to team up!</p>
          <div className="flex gap-3">
            <button
              onClick={() => handleRespondInvite(false)}
              disabled={responding}
              className="flex-1 py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold disabled:opacity-40"
            >
              Decline
            </button>
            <button
              onClick={() => handleRespondInvite(true)}
              disabled={responding}
              className="flex-1 py-3 rounded-lg bg-accent text-ink-inverse text-body font-semibold disabled:opacity-40"
            >
              {responding ? "Forming…" : "Accept"}
            </button>
          </div>
        </div>
      )}

      <p className="text-headline text-ink-primary mb-2">Find a Teammate</p>
      <p className="text-body text-ink-secondary mb-4">Show your QR or scan someone else's.</p>

      <div className="flex justify-center gap-4 mb-5">
        {Array.from({ length: comp.team_size }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-ink-muted/40 flex items-center justify-center">
              <span className="text-ink-muted text-body-lg">?</span>
            </div>
            <p className="text-caption text-ink-muted">Open</p>
          </div>
        ))}
      </div>

      {myQrUrl && (
        <div className="bg-bg-surface rounded-xl p-4 mb-4 inline-block">
          <img src={myQrUrl} width={180} height={180} alt="Your team QR" className="rounded-lg mx-auto mb-2" />
          <p className="text-caption text-ink-muted">Your personal QR code</p>
        </div>
      )}

      <button
        onClick={() => setScanning(true)}
        className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3 flex items-center justify-center gap-2"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="7" y1="12" x2="17" y2="12" />
        </svg>
        Scan Teammate's Code
      </button>

      {inviteSent && <p className="text-success text-body font-semibold mb-3">Invite sent! Waiting for them to accept…</p>}
      {error && <p className="text-error text-caption mt-3">{error}</p>}
    </div>
  );
}
