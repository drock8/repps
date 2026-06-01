import { Fragment, useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth, type Profile } from "../contexts/AuthContext";

interface TeamData {
  id: string;
  name: string;
  join_code: string;
  captain_id: string;
  status: "forming" | "active" | "disbanded";
  created_at: string;
}

interface MemberWithReps extends Profile {
  today_count: number;
}

type View = "no-team" | "invite" | "detail";

export default function Team() {
  const { profile, refreshProfile } = useAuth();
  const [view, setView] = useState<View>("no-team");
  const [team, setTeam] = useState<TeamData | null>(null);
  const [members, setMembers] = useState<MemberWithReps[]>([]);
  const [loading, setLoading] = useState(true);

  // Create team state
  const [teamName, setTeamName] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  // Join by code state
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  // Leave state
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaveInput, setLeaveInput] = useState("");
  const [leaving, setLeaving] = useState(false);

  // Remove member state
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Share state
  const [copied, setCopied] = useState(false);

  // Scoring info modal
  const [showScoring, setShowScoring] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Invite screen (after create)
  const [newJoinCode, setNewJoinCode] = useState("");

  const fetchTeamData = useCallback(async () => {
    if (!profile?.team_id) {
      setTeam(null);
      setMembers([]);
      setView("no-team");
      setLoading(false);
      return;
    }

    const { data: teamData } = await supabase
      .from("teams")
      .select("*")
      .eq("id", profile.team_id)
      .single();

    if (!teamData) {
      setView("no-team");
      setLoading(false);
      return;
    }

    setTeam(teamData);

    const { data: memberProfiles } = await supabase
      .from("profiles")
      .select("*")
      .eq("team_id", profile.team_id);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const membersWithReps: MemberWithReps[] = await Promise.all(
      (memberProfiles || []).map(async (m) => {
        const { count } = await supabase
          .from("reps")
          .select("*", { count: "exact", head: true })
          .eq("user_id", m.id)
          .gte("validated_at", todayStart.toISOString());
        return { ...m, today_count: count || 0 };
      })
    );

    setMembers(membersWithReps);
    setView("detail");
    setLoading(false);
  }, [profile?.team_id]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  const handleCreate = async () => {
    const trimmed = teamName.trim();
    if (trimmed.length < 3 || trimmed.length > 24) {
      setCreateError("Team name must be 3–24 characters");
      return;
    }
    setCreating(true);
    setCreateError("");
    const { data, error } = await supabase.rpc("create_team", { p_name: trimmed });
    if (error) {
      setCreateError(error.message);
      setCreating(false);
      return;
    }
    if (data && !data.success) {
      setCreateError(data.message || data.error);
      setCreating(false);
      return;
    }
    await refreshProfile();
    setNewJoinCode(data.join_code);
    setTeamName("");
    setCreating(false);
    setView("invite");
  };

  const handleJoinByCode = async () => {
    const trimmed = joinCode.trim();
    if (!trimmed) {
      setJoinError("Enter a join code");
      return;
    }
    setJoining(true);
    setJoinError("");
    const { data, error } = await supabase.rpc("join_team", { p_join_code: trimmed });
    if (error) {
      setJoinError(error.message);
      setJoining(false);
      return;
    }
    if (data && !data.success) {
      const msgs: Record<string, string> = {
        team_not_found: "No team found with that code",
        team_full: "This team is already full (3/3)",
        already_on_team: "You're already on a team",
        team_disbanded: "This team has been disbanded",
      };
      setJoinError(msgs[data.error] || data.message || data.error);
      setJoining(false);
      return;
    }
    await refreshProfile();
    setJoinCode("");
    setJoining(false);
  };

  const handleLeave = async () => {
    if (leaveInput.toLowerCase() !== "leave") return;
    setLeaving(true);
    await supabase.rpc("leave_team");
    await refreshProfile();
    setLeaving(false);
    setShowLeaveConfirm(false);
    setLeaveInput("");
  };

  const handleRemoveMember = async (memberId: string) => {
    setRemoving(true);
    const { data } = await supabase.rpc("remove_member", { p_user_id: memberId });
    if (data?.success) {
      await fetchTeamData();
    }
    setRemoving(false);
    setRemovingMemberId(null);
  };

  const handleShare = async () => {
    const code = team?.join_code || newJoinCode;
    if (!code) return;
    const name = team?.name || teamName;
    const url = `${window.location.origin}/team/join/${code}`;
    const text = `Join ${name} on REPPs — we're on a mission to inspire 1,000,000 people to move more and live better. It starts with one rep. ${url}`;

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

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Teams</p>
        <p className="text-body text-ink-secondary text-center">
          Sign in to create or join a team
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Invite screen (shown right after creating a team) ───
  if (view === "invite") {
    return (
      <div className="flex flex-col items-center pt-8 px-4">
        <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-headline text-ink-primary mb-1">Team Created</p>
        <p className="text-body text-ink-secondary text-center mb-6">
          Invite 2 teammates to unlock multipliers
        </p>

        <div className="w-full max-w-sm bg-bg-surface rounded-lg p-6 flex flex-col items-center gap-4">
          <p className="text-micro text-ink-muted uppercase tracking-wide">Join Code</p>
          <button
            onClick={() => handleCopyCode(newJoinCode)}
            className="text-display-md text-accent tracking-widest font-bold"
          >
            {newJoinCode}
          </button>
          <p className="text-caption text-ink-muted">
            {copied ? "Copied!" : "Tap code to copy"}
          </p>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-3 mt-6">
          <button
            onClick={handleShare}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            Invite Teammates
          </button>
          <button
            onClick={() => fetchTeamData()}
            className="w-full py-3 rounded-pill bg-bg-elevated text-ink-secondary font-semibold text-body transition-all duration-200 ease-apple active:scale-95"
          >
            Go to Team
          </button>
        </div>
      </div>
    );
  }

  // ─── No team: create or join ───
  if (view === "no-team") {
    return (
      <div className="flex flex-col items-center pt-8 px-4">
        <p className="text-headline text-ink-primary mb-1">Create a Team</p>
        <p className="text-body text-ink-secondary text-center mb-6">
          Teams of 3 unlock multipliers on your Rep Score
        </p>

        <div className="w-full max-w-sm flex flex-col gap-3">
          <input
            type="text"
            placeholder="Team name (3–24 characters)"
            value={teamName}
            onChange={(e) => { setTeamName(e.target.value); setCreateError(""); }}
            maxLength={24}
            className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
          />
          {createError && <p className="text-caption text-error">{createError}</p>}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Team"}
          </button>
        </div>

        <div className="w-full max-w-sm mt-8">
          {!showJoinInput ? (
            <button
              onClick={() => setShowJoinInput(true)}
              className="w-full text-center text-caption text-ink-secondary"
            >
              Have a code? Join a team
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-caption text-ink-secondary text-center">Enter join code</p>
              <input
                type="text"
                placeholder="e.g. A1B2C3"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
                maxLength={6}
                autoFocus
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent text-center tracking-widest uppercase"
              />
              {joinError && <p className="text-caption text-error">{joinError}</p>}
              <button
                onClick={handleJoinByCode}
                disabled={joining}
                className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {joining ? "Joining..." : "Join Team"}
              </button>
              <button
                onClick={() => { setShowJoinInput(false); setJoinCode(""); setJoinError(""); }}
                className="w-full py-2 text-caption text-ink-muted text-center"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Team detail view ───
  if (!team) return null;
  const isCaptain = team.captain_id === profile.id;
  const dailyTarget = 5;

  return (
    <div className="flex flex-col pb-8">
      {/* Team header */}
      <div className="flex flex-col items-center pt-4 mb-6">
        <div className="flex items-center gap-2">
          <p className="text-headline text-ink-primary">{team.name}</p>
          <span className={`text-micro uppercase tracking-wide px-2 py-0.5 rounded-pill ${
            team.status === "active"
              ? "bg-success/20 text-success"
              : "bg-accent/20 text-accent"
          }`}>
            {team.status}
          </span>
        </div>
        <p className="text-caption text-ink-muted mt-1">
          {members.length}/3 members
        </p>
      </div>

      {/* Members list */}
      <div className="flex flex-col gap-2 mb-6">
        <p className="text-micro text-ink-muted uppercase tracking-wide">Members</p>
        {members.map((m) => (
          <div key={m.id} className="bg-bg-surface rounded-lg overflow-hidden">
            <div className="p-4 flex items-center gap-3">
              {m.avatar_url ? (
                <img
                  src={m.avatar_url}
                  alt={m.name}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <span className="text-body-lg font-bold text-ink-inverse">
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-body font-semibold text-ink-primary truncate">{m.name}</p>
                  {team.captain_id === m.id && (
                    <span className="text-micro text-accent uppercase tracking-wide flex-shrink-0">Capt</span>
                  )}
                </div>
                <p className="text-caption text-ink-muted">
                  {m.today_count}/{dailyTarget} today
                </p>
              </div>
              <div className="flex items-center flex-shrink-0 w-[4.5rem] justify-end gap-2">
                {m.today_count >= dailyTarget ? (
                  <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center">
                    <span className="text-caption text-ink-muted font-bold">
                      {m.today_count}
                    </span>
                  </div>
                )}
                {isCaptain && m.id !== profile.id ? (
                  <button
                    onClick={() => setRemovingMemberId(removingMemberId === m.id ? null : m.id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ease-apple hover:bg-bg-elevated"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </button>
                ) : (
                  <div className="w-8" />
                )}
              </div>
            </div>
            {removingMemberId === m.id && (
              <div className="px-4 pb-4 flex gap-2">
                <button
                  onClick={() => handleRemoveMember(m.id)}
                  disabled={removing}
                  className="flex-1 py-2 rounded-pill bg-error/20 text-error text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
                >
                  {removing ? "Removing..." : `Remove ${m.name.split(" ")[0]}`}
                </button>
                <button
                  onClick={() => setRemovingMemberId(null)}
                  className="py-2 px-4 rounded-pill bg-bg-elevated text-ink-muted text-caption font-semibold transition-all duration-200 ease-apple active:scale-95"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Empty member slots */}
        {Array.from({ length: 3 - members.length }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-bg-surface rounded-lg p-4 flex items-center gap-3 opacity-40">
            <div className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <p className="text-body text-ink-muted">Waiting for teammate...</p>
          </div>
        ))}
      </div>

      {/* Invite button (captain only, when forming) */}
      {isCaptain && team.status === "forming" && (
        <div className="flex flex-col gap-3 mb-6">
          <button
            onClick={handleShare}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
          >
            {copied ? "Link Copied!" : "Invite Teammates"}
          </button>
          <div className="bg-bg-surface rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-micro text-ink-muted uppercase tracking-wide">Join Code</p>
              <p className="text-body text-ink-primary font-bold tracking-widest mt-0.5">{team.join_code}</p>
            </div>
            <button
              onClick={() => handleCopyCode(team.join_code)}
              className="text-caption text-accent font-semibold px-3 py-2 rounded-pill bg-bg-elevated transition-all duration-200 ease-apple active:scale-95"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Daily target info */}
      <div className="bg-bg-surface rounded-lg p-4 mb-4">
        <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Daily Team Target</p>
        <p className="text-body text-ink-secondary">
          All 3 members hit <span className="text-accent font-bold">{dailyTarget} reps</span> to unlock the <span className="text-accent font-bold">3x multiplier</span>
        </p>
        {team.status === "active" && (
          <div className="mt-3">
            {members.every(m => m.today_count >= dailyTarget) ? (
              <p className="text-caption text-success font-semibold">3x multiplier active today</p>
            ) : (
              <p className="text-caption text-ink-muted">
                {members.filter(m => m.today_count >= dailyTarget).length}/3 members hit target today
              </p>
            )}
          </div>
        )}
      </div>

      {/* How to maximize button */}
      <button
        onClick={() => setShowScoring(true)}
        className="w-full py-3 mb-6 rounded-pill bg-bg-surface text-ink-secondary font-semibold text-caption flex items-center justify-center gap-2 transition-all duration-200 ease-apple active:scale-95"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        How to maximize your Rep Score
      </button>

      {/* Scoring explainer modal */}
      {showScoring && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setShowScoring(false); }}
        >
          <div
            ref={modalRef}
            className="w-full max-w-md max-h-[85vh] bg-bg-base rounded-t-2xl overflow-y-auto overscroll-contain"
          >
            <div className="sticky top-0 bg-bg-base z-10 px-5 pt-5 pb-3 flex items-center justify-between border-b border-bg-elevated">
              <p className="text-body-lg text-ink-primary font-bold">Maximize Your Rep Score</p>
              <button
                onClick={() => setShowScoring(false)}
                className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-ink-muted">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-5">
              {/* Base */}
              <div>
                <p className="text-caption text-ink-primary font-bold mb-1">Base Points</p>
                <p className="text-caption text-ink-secondary">Every validated burpee = <span className="text-accent font-bold">1 point</span></p>
              </div>

              {/* Daily 3x */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-body-lg">🔥</span>
                  <p className="text-caption text-ink-primary font-bold">Daily Team Bonus (3x)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  When all 3 team members hit <span className="font-semibold">{dailyTarget}+ reps</span> in a day, everyone's base points for that day are <span className="text-accent font-bold">tripled</span>.
                </p>
              </div>

              {/* Weekly 2x */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-body-lg">📅</span>
                  <p className="text-caption text-ink-primary font-bold">Weekly Team Bonus (2x)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  If all 3 members hit the daily target on at least <span className="font-semibold">5 of 7 days</span> in a week, the whole week's points are <span className="text-accent font-bold">doubled</span>. Stacks with the daily 3x — a perfect week = <span className="text-accent font-bold">6x</span>.
                </p>
              </div>

              {/* Individual streak */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-body-lg">⚡</span>
                  <p className="text-caption text-ink-primary font-bold">Individual Streak (+1 → +11)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  Hit the daily target on consecutive days to build your streak. Starting day 2, earn <span className="font-semibold">+1 bonus per day</span>. Every 10 days it escalates by +1, capping at <span className="text-accent font-bold">+11/day</span> (day 101+). Miss a day? Streak resets to zero.
                </p>
              </div>

              {/* Team streak */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-body-lg">👥</span>
                  <p className="text-caption text-ink-primary font-bold">Team Streak (+3 → +33)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  When <span className="font-semibold">all 3 members</span> hit the target on consecutive days, the team streak grows. Starts at <span className="font-semibold">+3/day per member</span>, escalating by +3 every 10 days, capping at <span className="text-accent font-bold">+33/day</span>. If anyone misses, the whole team streak resets.
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-bg-elevated" />

              {/* Example comparison */}
              <div>
                <p className="text-caption text-ink-primary font-bold mb-2">30-Day Example: Solo vs Team</p>
                <p className="text-micro text-ink-muted mb-3">5 burpees/day for 30 days straight</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-bg-surface rounded-lg p-3 flex flex-col items-center">
                    <p className="text-micro text-ink-muted uppercase tracking-wide mb-1">Solo</p>
                    <p className="text-display-sm text-ink-primary font-bold">209</p>
                    <p className="text-micro text-ink-muted">pts</p>
                    <p className="text-micro text-ink-secondary mt-1">1.4x return</p>
                  </div>
                  <div className="bg-accent/10 rounded-lg p-3 flex flex-col items-center ring-1 ring-accent/30">
                    <p className="text-micro text-accent uppercase tracking-wide mb-1">With Team</p>
                    <p className="text-display-sm text-accent font-bold">1,854</p>
                    <p className="text-micro text-ink-muted">pts</p>
                    <p className="text-micro text-accent font-semibold mt-1">12.4x return</p>
                  </div>
                </div>

                <p className="text-micro text-ink-secondary mt-3 text-center">
                  Same 150 burpees — a team that shows up together scores <span className="text-accent font-bold">~9x more</span>
                </p>
              </div>

              {/* Key days breakdown */}
              <div>
                <p className="text-caption text-ink-primary font-bold mb-2">How Points Build (with team)</p>
                <div className="bg-bg-surface rounded-lg overflow-hidden">
                  <div className="grid grid-cols-4 gap-px bg-bg-elevated text-micro">
                    <div className="bg-bg-surface px-2 py-1.5 font-bold text-ink-muted">Day</div>
                    <div className="bg-bg-surface px-2 py-1.5 font-bold text-ink-muted text-right">Base</div>
                    <div className="bg-bg-surface px-2 py-1.5 font-bold text-ink-muted text-right">Bonus</div>
                    <div className="bg-bg-surface px-2 py-1.5 font-bold text-ink-muted text-right">Total</div>
                    {[
                      { day: 1, base: 15, streak: 0, team: 0 },
                      { day: 2, base: 15, streak: 1, team: 3 },
                      { day: 10, base: 15, streak: 1, team: 3 },
                      { day: 11, base: 15, streak: 2, team: 6 },
                      { day: 21, base: 15, streak: 3, team: 9 },
                      { day: 30, base: 15, streak: 3, team: 9 },
                    ].map((r) => (
                      <Fragment key={r.day}>
                        <div className="bg-bg-surface px-2 py-1.5 text-ink-secondary">{r.day}</div>
                        <div className="bg-bg-surface px-2 py-1.5 text-ink-secondary text-right">{r.base}</div>
                        <div className="bg-bg-surface px-2 py-1.5 text-accent text-right">+{r.streak + r.team}</div>
                        <div className="bg-bg-surface px-2 py-1.5 text-ink-primary font-semibold text-right">{r.base + r.streak + r.team}</div>
                      </Fragment>
                    ))}
                  </div>
                </div>
                <p className="text-micro text-ink-muted mt-2">Base = 5 reps × 3x daily team bonus. Bonuses escalate every 10 days. Weekly 2x applied on top.</p>
              </div>

              {/* Bottom padding for scroll */}
              <div className="h-4" />
            </div>
          </div>
        </div>
      )}

      {/* Leave team */}
      {!showLeaveConfirm ? (
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="w-full py-3 text-caption text-ink-muted text-center"
        >
          Leave team
        </button>
      ) : (
        <div className="bg-bg-surface rounded-lg p-4 flex flex-col gap-3">
          <p className="text-body text-ink-primary font-semibold">Leave {team.name}?</p>
          <p className="text-caption text-ink-secondary">
            Type <span className="text-error font-bold">"leave"</span> to confirm. Your team's streak may reset.
          </p>
          <input
            type="text"
            placeholder='Type "leave"'
            value={leaveInput}
            onChange={(e) => setLeaveInput(e.target.value)}
            autoFocus
            className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-error"
          />
          <div className="flex gap-3">
            <button
              onClick={handleLeave}
              disabled={leaving || leaveInput.toLowerCase() !== "leave"}
              className="flex-1 py-3 rounded-pill bg-error text-ink-primary font-bold text-body transition-all duration-200 ease-apple active:scale-95 disabled:opacity-30"
            >
              {leaving ? "Leaving..." : "Confirm Leave"}
            </button>
            <button
              onClick={() => { setShowLeaveConfirm(false); setLeaveInput(""); }}
              className="flex-1 py-3 rounded-pill bg-bg-elevated text-ink-secondary font-semibold text-body transition-all duration-200 ease-apple active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
