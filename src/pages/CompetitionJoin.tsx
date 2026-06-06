import { useEffect, useState, useCallback } from "react";
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
  participant_count: number;
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
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [showProfileGate, setShowProfileGate] = useState(false);

  // Team pairing state
  const [myQrUrl, setMyQrUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [inviteFrom, setInviteFrom] = useState<Inviter | null>(null);
  const [responding, setResponding] = useState(false);
  const [teamFormed, setTeamFormed] = useState<TeamInfo | null>(null);
  const [inviteSent, setInviteSent] = useState(false);

  const loadTeam = useCallback(async (_compId: string, teamId: string) => {
    const { data: team } = await supabase
      .from("competition_teams")
      .select("id, name")
      .eq("id", teamId)
      .single();
    if (!team) return;

    const { data: members } = await supabase
      .from("competition_participants")
      .select("user_id, profiles!inner(name, avatar_url)")
      .eq("competition_team_id", teamId)
      .neq("status", "withdrawn");

    const parsed: TeamMember[] = (members || []).map((m: Record<string, unknown>) => {
      const p = m.profiles as Record<string, unknown>;
      return {
        user_id: m.user_id as string,
        name: p.name as string,
        avatar_url: (p.avatar_url as string) || null,
      };
    });

    setTeamFormed({ id: team.id, name: team.name, members: parsed });
  }, []);

  const loadCompetition = useCallback(async () => {
    if (!joinCode) return;
    setLoading(true);
    const { data: compData } = await supabase
      .from("competition_settings")
      .select("id, name, state, team_size, duration_seconds, target_type, join_code")
      .eq("join_code", joinCode.toUpperCase())
      .single();

    if (!compData) {
      setError("Competition not found");
      setLoading(false);
      return;
    }

    const { count } = await supabase
      .from("competition_participants")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", compData.id)
      .neq("status", "withdrawn");

    if (profile) {
      const { data: existing } = await supabase
        .from("competition_participants")
        .select("id, competition_team_id")
        .eq("competition_id", compData.id)
        .eq("user_id", profile.id)
        .neq("status", "withdrawn")
        .maybeSingle();
      if (existing) {
        setAlreadyJoined(true);
        if (existing.competition_team_id) {
          await loadTeam(compData.id, existing.competition_team_id);
        }
      }
    }

    setComp({ ...compData, participant_count: count || 0 });
    setLoading(false);
  }, [joinCode, profile, loadTeam]);

  useEffect(() => {
    loadCompetition();
  }, [loadCompetition]);

  // Generate personal QR for team pairing
  useEffect(() => {
    if (!profile || !comp || !alreadyJoined || comp.team_size <= 1) return;
    if (teamFormed && teamFormed.members.length >= comp.team_size) return;
    const url = `${window.location.origin}/compete/${comp.join_code}?pair=${profile.id}`;
    generateStyledQRDataUrl(url, 200).then(setMyQrUrl);
  }, [profile, comp, alreadyJoined, teamFormed]);

  // Poll for incoming team invites, team formation, and team growth
  useEffect(() => {
    if (!profile || !comp || !alreadyJoined || comp.team_size <= 1) return;
    // Stop polling only when team is full
    if (teamFormed && teamFormed.members.length >= comp.team_size) return;

    const poll = async () => {
      const { data: me } = await supabase
        .from("competition_participants")
        .select("team_invite_from, competition_team_id")
        .eq("competition_id", comp.id)
        .eq("user_id", profile.id)
        .neq("status", "withdrawn")
        .maybeSingle();

      if (!me) return;

      // Team assigned — load or refresh team data
      if (me.competition_team_id) {
        await loadTeam(comp.id, me.competition_team_id);
        return;
      }

      // Check for incoming invite
      if (me.team_invite_from && !inviteFrom) {
        const { data: inviter } = await supabase
          .from("profiles")
          .select("id, name, avatar_url")
          .eq("id", me.team_invite_from)
          .single();
        if (inviter) setInviteFrom(inviter);
      } else if (!me.team_invite_from && inviteFrom) {
        setInviteFrom(null);
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [profile, comp, alreadyJoined, teamFormed, inviteFrom, loadTeam]);

  function handleJoinClick() {
    if (!profile || !comp) return;
    const needsProfile = !profile.dob || !profile.nationality_code;
    if (needsProfile) {
      setShowProfileGate(true);
      return;
    }
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
      if (data?.error === "already_joined") {
        setAlreadyJoined(true);
        setJoining(false);
        return;
      }
      setError(rpcErr?.message || data?.message || data?.error || "Failed to join");
      setJoining(false);
      return;
    }

    setAlreadyJoined(true);
    setJoining(false);
  }

  const handleScanResult = useCallback(async (value: string) => {
    setScanning(false);
    if (!comp || !profile) return;

    const pairMatch = value.match(/[?&]pair=([a-f0-9-]+)/i);
    if (!pairMatch) {
      setError("Not a valid teammate QR code");
      return;
    }

    const targetUserId = pairMatch[1];
    if (targetUserId === profile.id) {
      setError("That's your own QR code!");
      return;
    }

    setError("");
    setInviteSent(false);
    const { data, error: rpcErr } = await supabase.rpc("send_team_invite", {
      p_competition_id: comp.id,
      p_target_user_id: targetUserId,
    });

    if (rpcErr || !data?.success) {
      const errCode = data?.error;
      const messages: Record<string, string> = {
        target_not_participant: "They haven't joined the competition yet",
        target_already_on_team: "They're already on a team",
        target_has_pending_invite: "They already have a pending invite",
        team_full: "Your team is full",
        cannot_invite_self: "That's your own QR code!",
      };
      setError(messages[errCode] || rpcErr?.message || errCode || "Failed to send invite");
      return;
    }

    setInviteSent(true);
    setTimeout(() => setInviteSent(false), 5000);
  }, [comp, profile]);

  async function handleRespondInvite(accept: boolean) {
    if (!comp) return;
    setResponding(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc("respond_team_invite", {
      p_competition_id: comp.id,
      p_accept: accept,
    });

    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.error || "Failed to respond");
      setResponding(false);
      return;
    }

    if (accept && data.team_id) {
      await loadTeam(comp.id, data.team_id);
    }
    setInviteFrom(null);
    setResponding(false);
  }

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
        <button
          onClick={() => navigate("/events")}
          className="mt-4 text-accent text-body font-semibold"
        >
          Browse Events
        </button>
      </div>
    );
  }

  const joinable = comp.state === "join_open" || comp.state === "join_closed";
  const isTeamComp = comp.team_size > 1;
  const durationLabel = comp.duration_seconds
    ? comp.duration_seconds >= 60
      ? `${Math.floor(comp.duration_seconds / 60)} min`
      : `${comp.duration_seconds}s`
    : "Target-based";
  const teamIsFull = teamFormed ? teamFormed.members.length >= comp.team_size : false;

  return (
    <div className="px-5 pt-6 pb-28 max-w-md mx-auto">
      <div className="text-center mb-8">
        <p className="text-micro text-accent uppercase tracking-widest mb-2">REPPs Live</p>
        <h1 className="text-display-md text-ink-primary mb-2">{comp.name}</h1>
        <div className="flex items-center justify-center gap-4 text-body text-ink-secondary">
          <span>{durationLabel}</span>
          <span>·</span>
          <span>{isTeamComp ? `Teams of ${comp.team_size}` : "Individual"}</span>
          <span>·</span>
          <span>{comp.participant_count} joined</span>
        </div>
      </div>

      {/* Team formed (or forming) — show members */}
      {alreadyJoined && teamFormed ? (
        <div className="text-center">
          <div className={`${teamIsFull ? "bg-success/10" : "bg-accent/10"} rounded-xl p-6 mb-6`}>
            <p className={`text-micro uppercase tracking-widest font-bold mb-3 ${teamIsFull ? "text-success" : "text-accent"}`}>
              {teamIsFull ? "Team Ready" : `${teamFormed.members.length} of ${comp.team_size} teammates`}
            </p>
            <p className="text-headline text-ink-primary mb-4">{teamFormed.name}</p>
            <div className="flex justify-center gap-4 flex-wrap">
              {teamFormed.members.map((m) => (
                <div key={m.user_id} className="flex flex-col items-center gap-1">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" referrerPolicy="no-referrer" className="w-14 h-14 rounded-full object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-headline font-bold">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p className="text-caption text-ink-primary font-semibold">{m.name}</p>
                </div>
              ))}
              {Array.from({ length: comp.team_size - teamFormed.members.length }).map((_, i) => (
                <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 rounded-full border-2 border-dashed border-ink-muted/40 flex items-center justify-center">
                    <span className="text-ink-muted text-headline">?</span>
                  </div>
                  <p className="text-caption text-ink-muted">Open</p>
                </div>
              ))}
            </div>
          </div>

          {!teamIsFull && (
            <>
              <p className="text-body text-ink-secondary mb-4">
                Scan a teammate's code to add them, or show yours.
              </p>
              {myQrUrl && (
                <div className="bg-bg-surface rounded-xl p-6 mb-4 inline-block">
                  <img src={myQrUrl} width={180} height={180} alt="Your team QR" className="rounded-lg mx-auto mb-2" />
                  <p className="text-caption text-ink-muted">Your QR code</p>
                </div>
              )}
              <button
                onClick={() => setScanning(true)}
                className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3 flex items-center justify-center gap-2"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                </svg>
                Scan to Add Teammate
              </button>
              {inviteSent && (
                <p className="text-success text-body font-semibold mb-3">Invite sent! Waiting for them to accept…</p>
              )}
            </>
          )}

          {teamIsFull && (
            <button
              onClick={() => navigate(`/dab?comp=${comp.id}`)}
              className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3"
            >
              Get Ready
            </button>
          )}
          <button
            onClick={() => navigate(`/live/${comp.id}`)}
            className="w-full py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold"
          >
            Watch Dashboard
          </button>
          {error && <p className="text-error text-caption mt-3">{error}</p>}
        </div>
      ) : alreadyJoined && isTeamComp ? (
        /* Joined but no team yet — Find Teammate flow */
        <div className="text-center">
          {inviteFrom && (
            <div className="bg-accent/10 rounded-xl p-6 mb-6">
              <p className="text-micro text-accent uppercase tracking-widest font-bold mb-3">Team Request</p>
              <div className="flex items-center justify-center gap-3 mb-4">
                {inviteFrom.avatar_url ? (
                  <img src={inviteFrom.avatar_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-body-lg font-bold">
                    {inviteFrom.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-body-lg text-ink-primary font-semibold">{inviteFrom.name}</p>
              </div>
              <p className="text-body text-ink-secondary mb-4">wants to team up with you!</p>
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
          <p className="text-body text-ink-secondary mb-6">
            Show your QR code, or scan someone else's to team up.
          </p>

          {myQrUrl && (
            <div className="bg-bg-surface rounded-xl p-6 mb-6 inline-block">
              <img src={myQrUrl} width={200} height={200} alt="Your team QR" className="rounded-lg mx-auto mb-3" />
              <p className="text-caption text-ink-muted">Your personal QR code</p>
            </div>
          )}

          <button
            onClick={() => setScanning(true)}
            className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3 flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
            Scan Teammate's Code
          </button>

          {inviteSent && (
            <p className="text-success text-body font-semibold mb-3">Invite sent! Waiting for them to accept…</p>
          )}
          {error && <p className="text-error text-caption mt-3">{error}</p>}
        </div>
      ) : alreadyJoined ? (
        /* Already joined individual comp */
        <div className="text-center">
          <p className="text-body-lg text-ink-primary mb-4">You're in! Get ready to compete.</p>
          <button
            onClick={() => navigate(`/dab?comp=${comp.id}`)}
            className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold mb-3"
          >
            Get Ready
          </button>
          <button
            onClick={() => navigate(`/live/${comp.id}`)}
            className="w-full py-3 rounded-lg bg-bg-surface text-ink-secondary text-body font-semibold"
          >
            Watch Dashboard
          </button>
        </div>
      ) : !joinable ? (
        <div className="text-center">
          <p className="text-body text-ink-secondary mb-4">
            {comp.state === "draft" || comp.state === "announced"
              ? "Entries aren't open yet. Watch the big screen!"
              : "This competition is underway."}
          </p>
          <button
            onClick={() => navigate(`/live/${comp.id}`)}
            className="w-full py-4 rounded-lg bg-bg-surface text-ink-primary text-body-lg font-semibold"
          >
            Watch Live
          </button>
        </div>
      ) : (
        <>
          {error && <p className="text-error text-caption mb-4">{error}</p>}
          <button
            onClick={handleJoinClick}
            disabled={joining}
            className="w-full py-4 rounded-lg bg-accent text-ink-inverse text-body-lg font-semibold disabled:opacity-40 transition-opacity"
          >
            {joining ? "Joining…" : "Join Competition"}
          </button>
        </>
      )}

      {showProfileGate && (
        <ProfileGate
          onComplete={() => {
            setShowProfileGate(false);
            doJoin();
          }}
          onSkip={() => {
            setShowProfileGate(false);
            doJoin();
          }}
        />
      )}
    </div>
  );
}
