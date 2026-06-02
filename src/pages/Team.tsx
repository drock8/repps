import { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth, type Profile } from "../contexts/AuthContext";
import ActivityHeatmap from "../components/ActivityHeatmap";
import WeeklyBarChart from "../components/WeeklyBarChart";

interface TeamData {
  id: string;
  name: string;
  join_code: string;
  captain_id: string;
  status: "forming" | "active" | "disbanded";
  created_at: string;
  logo_url: string | null;
  pending_logo_url: string | null;
  pending_logo_uploaded_by: string | null;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

interface MemberWithReps extends Profile {
  today_count: number;
  today_base: number;
  today_daily_multiplied: number;
  today_streak_bonus: number;
  today_team_streak_bonus: number;
  today_total: number;
}

type View = "no-team" | "invite" | "detail";

export default function Team() {
  const { profile, refreshProfile } = useAuth();
  const [view, setView] = useState<View>("no-team");
  const [team, setTeam] = useState<TeamData | null>(null);
  const [members, setMembers] = useState<MemberWithReps[]>([]);
  const [loading, setLoading] = useState(true);

  // Team metrics
  const [teamStreak, setTeamStreak] = useState<{ current: number; longest: number }>({ current: 0, longest: 0 });
  const [teamDailyCounts, setTeamDailyCounts] = useState<{ day: string; count: number }[]>([]);
  const [teamScore, setTeamScore] = useState<{ total: number; baseReps: number; streakBonus: number; teamStreakBonus: number; multiplied: number } | null>(null);

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

  // Logo upload state
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");

  // Rename team state
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);

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
        const [todayRes, histRes] = await Promise.all([
          supabase
            .from("reps")
            .select("*", { count: "exact", head: true })
            .eq("user_id", m.id)
            .gte("validated_at", todayStart.toISOString()),
          supabase.rpc("get_user_score_history", { p_user_id: m.id, p_limit: 1 }),
        ]);
        const todayRow = (histRes.data as { day: string; reps: number; daily_multiplied: number; streak_bonus: number; team_streak_bonus: number; day_total: number }[] | null)?.[0];
        const todayStr = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, "0")}-${String(todayStart.getDate()).padStart(2, "0")}`;
        const isToday = todayRow && todayRow.day === todayStr;
        return {
          ...m,
          today_count: todayRes.count || 0,
          today_base: isToday ? Number(todayRow.reps) : 0,
          today_daily_multiplied: isToday ? Number(todayRow.daily_multiplied) : 0,
          today_streak_bonus: isToday ? Number(todayRow.streak_bonus) : 0,
          today_team_streak_bonus: isToday ? Number(todayRow.team_streak_bonus) : 0,
          today_total: isToday ? Number(todayRow.day_total) : 0,
        };
      })
    );

    setMembers(membersWithReps);

    // Fetch team streak
    const { data: streakData } = await supabase.rpc("get_team_streak", { p_team_id: profile.team_id });
    if (streakData) {
      const row = Array.isArray(streakData) ? streakData[0] : streakData;
      if (row) {
        setTeamStreak({ current: Number(row.current_streak), longest: Number(row.longest_streak) });
      }
    }

    // Fetch team combined rep score
    const scoreResults = await Promise.all(
      (memberProfiles || []).map(m =>
        supabase.rpc("calculate_user_rep_score", { p_user_id: m.id, p_period: "all" })
      )
    );
    let totalScore = 0, totalBase = 0, totalStreak = 0, totalTeamStreak = 0;
    for (const res of scoreResults) {
      if (res.data) {
        const s = res.data as { score: number; base_reps: number; individual_streak: number; team_streak: number };
        totalScore += Number(s.score);
        totalBase += Number(s.base_reps);
        totalStreak += Number(s.individual_streak);
        totalTeamStreak += Number(s.team_streak);
      }
    }
    const totalMultiplied = totalScore - totalBase - totalStreak - totalTeamStreak;
    setTeamScore({ total: totalScore, baseReps: totalBase, streakBonus: totalStreak, teamStreakBonus: totalTeamStreak, multiplied: Math.max(0, totalMultiplied) });

    // Fetch team aggregate daily counts (sum all members' reps per day)
    const memberIds = (memberProfiles || []).map(m => m.id);
    if (memberIds.length > 0) {
      const since = new Date();
      since.setMonth(since.getMonth() - 3);
      const { data: teamReps } = await supabase
        .from("reps")
        .select("validated_at")
        .in("user_id", memberIds)
        .gte("validated_at", since.toISOString());

      if (teamReps) {
        const dayMap = new Map<string, number>();
        for (const r of teamReps) {
          const d = new Date(r.validated_at);
          const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          dayMap.set(day, (dayMap.get(day) || 0) + 1);
        }
        const counts = Array.from(dayMap.entries())
          .map(([day, count]) => ({ day, count }))
          .sort((a, b) => a.day.localeCompare(b.day));
        setTeamDailyCounts(counts);
      }
    }

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
        team_full: "This team is already full",
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
    const { data } = await supabase.rpc("leave_team");
    if (!data?.success) {
      setLeaving(false);
      return;
    }
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
    const text = `Join ${name} on REPPs — we're on a mission to inspire 1,000,000 people to move more and live better. It starts with one repp. ${url}`;

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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.team_id) return;
    setLogoError("");

    if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setLogoError("Only JPEG, PNG, WebP, and GIF allowed");
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setLogoError("Image must be under 5 MB");
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }

    setUploadingLogo(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const contentType = file.type || "image/jpeg";
    const path = `${profile.team_id}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("team-logos")
      .upload(path, file, { upsert: true, contentType });
    if (uploadError) {
      setLogoError("Upload failed — try again");
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }

    const { data: urlData } = supabase.storage
      .from("team-logos")
      .getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const isCaptainUpload = team?.captain_id === profile.id;

    const { error: updateError } = await supabase
      .from("teams")
      .update(
        isCaptainUpload
          ? { logo_url: publicUrl, pending_logo_url: null, pending_logo_uploaded_by: null }
          : { pending_logo_url: publicUrl, pending_logo_uploaded_by: profile.id }
      )
      .eq("id", profile.team_id);

    if (updateError) {
      setLogoError("Upload failed — try again");
    }

    await fetchTeamData();
    setUploadingLogo(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const handleApproveLogo = async () => {
    if (!team?.pending_logo_url) return;
    const { error } = await supabase
      .from("teams")
      .update({ logo_url: team.pending_logo_url, pending_logo_url: null, pending_logo_uploaded_by: null })
      .eq("id", team.id);
    if (!error) await fetchTeamData();
  };

  const handleRejectLogo = async () => {
    if (!team) return;
    const { error } = await supabase
      .from("teams")
      .update({ pending_logo_url: null, pending_logo_uploaded_by: null })
      .eq("id", team.id);
    if (!error) await fetchTeamData();
  };

  const handleRename = async () => {
    const trimmed = newName.trim();
    if (trimmed.length < 3 || trimmed.length > 24) {
      setRenameError("3–24 characters");
      return;
    }
    setRenaming(true);
    setRenameError("");
    const { data, error } = await supabase.rpc("rename_team", { p_name: trimmed });
    if (error || !data?.success) {
      setRenameError(data?.message || error?.message || "Rename failed");
      setRenaming(false);
      return;
    }
    setEditingName(false);
    setRenaming(false);
    await fetchTeamData();
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
          Invite a teammate to unlock multipliers
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
          Teams of 2+ unlock multipliers on your Repp Score
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
        <div className="flex items-center gap-4">
          {/* Team logo with camera badge */}
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadingLogo}
            className="relative flex-shrink-0"
          >
            {team.logo_url ? (
              <img
                src={team.logo_url}
                alt={team.name}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                  <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
                </svg>
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-lg">
              {uploadingLogo ? (
                <div className="w-3 h-3 border-2 border-ink-inverse border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111315" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
            </div>
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoUpload}
          />

          {/* Name, status, members */}
          <div className="flex flex-col min-w-0">
            {editingName ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setRenameError(""); }}
                    maxLength={24}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") { setEditingName(false); setRenameError(""); }
                    }}
                    className="w-full bg-bg-input text-ink-primary text-body font-semibold rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={handleRename}
                    disabled={renaming}
                    className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
                  >
                    {renaming ? (
                      <div className="w-3.5 h-3.5 border-2 border-ink-inverse border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111315" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setRenameError(""); }}
                    className="flex-shrink-0 w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center transition-all duration-200 ease-apple active:scale-95"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-ink-muted">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {renameError && <p className="text-micro text-error">{renameError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {isCaptain ? (
                  <button
                    onClick={() => { setNewName(team.name); setEditingName(true); setRenameError(""); }}
                    className="flex items-center gap-1.5 min-w-0 group"
                  >
                    <p className="text-headline text-ink-primary truncate">{team.name}</p>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted flex-shrink-0 opacity-0 group-active:opacity-100 transition-opacity">
                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                ) : (
                  <p className="text-headline text-ink-primary truncate">{team.name}</p>
                )}
                <span className={`text-micro uppercase tracking-wide px-2 py-0.5 rounded-pill flex-shrink-0 ${
                  team.status === "active"
                    ? "bg-success/20 text-success"
                    : "bg-accent/20 text-accent"
                }`}>
                  {team.status}
                </span>
              </div>
            )}
            <p className="text-caption text-ink-muted mt-0.5">
              {members.length}/3 members · {members.length >= 2 ? `${members.length}x` : "no"} multiplier
            </p>
          </div>
        </div>
        {logoError && <p className="text-micro text-error mt-1">{logoError}</p>}

        {/* Pending logo approval (captain only) */}
        {isCaptain && team.pending_logo_url && (
          <div className="mt-3 bg-bg-surface rounded-lg p-3 flex items-center gap-3">
            <img
              src={team.pending_logo_url}
              alt="Proposed logo"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-caption text-ink-primary font-semibold">New logo proposed</p>
              <p className="text-micro text-ink-muted truncate">
                by {members.find(m => m.id === team.pending_logo_uploaded_by)?.name || "a teammate"}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={handleApproveLogo}
                className="px-3 py-1.5 rounded-pill bg-success/20 text-success text-micro font-semibold transition-all duration-200 ease-apple active:scale-95"
              >
                Approve
              </button>
              <button
                onClick={handleRejectLogo}
                className="px-3 py-1.5 rounded-pill bg-bg-elevated text-ink-muted text-micro font-semibold transition-all duration-200 ease-apple active:scale-95"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Pending notice for non-captain who uploaded */}
        {!isCaptain && team.pending_logo_url && team.pending_logo_uploaded_by === profile.id && (
          <p className="mt-2 text-micro text-ink-muted italic">Logo pending captain approval</p>
        )}

        <button
          onClick={() => setShowScoring(true)}
          className="mt-3 py-2.5 px-5 rounded-pill bg-accent text-ink-inverse font-semibold text-caption flex items-center gap-2 transition-all duration-200 ease-apple active:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
            <path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13.01 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z"/>
          </svg>
          How to maximize your Repp Score
        </button>
      </div>

      {/* Team Repp Score — Today + All Time */}
      {(() => {
        const todayBase = members.reduce((s, m) => s + m.today_base, 0);
        const todayReps = members.reduce((s, m) => s + m.today_count, 0);
        const todayStreak = members.reduce((s, m) => s + m.today_streak_bonus + m.today_team_streak_bonus, 0);
        const todayTotal = members.reduce((s, m) => s + m.today_total, 0);
        const todayMultiplier = todayTotal - todayBase - todayStreak;
        const displayBase = todayBase || todayReps;
        const displayTotal = todayTotal || todayReps;
        return (
          <div className="bg-bg-surface rounded-lg p-4 mb-4">
            <div className="flex gap-4">
              {/* Today */}
              <div className="flex-1">
                <p className="text-micro text-ink-muted uppercase tracking-wide">Today</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <p className="text-display-md repps-gradient-text tabular-nums">
                    {displayTotal.toLocaleString()}
                  </p>
                  <p className="text-caption text-ink-muted">pts</p>
                </div>
                {displayTotal > 0 && (
                  <div className="flex flex-col gap-0.5 mt-2">
                    <span className="text-micro text-ink-secondary tabular-nums">{displayBase.toLocaleString()} base</span>
                    {todayStreak > 0 && (
                      <span className="text-micro text-blue-400 tabular-nums">+{todayStreak.toLocaleString()} streak bonus</span>
                    )}
                    {todayMultiplier > 0 && (
                      <span className="text-micro text-emerald-400 tabular-nums">+{todayMultiplier.toLocaleString()} team multiplier</span>
                    )}
                  </div>
                )}
              </div>
              {/* Divider */}
              <div className="w-px bg-divider" />
              {/* All Time */}
              <div className="flex-1">
                <p className="text-micro text-ink-muted uppercase tracking-wide">All Time</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <p className="text-display-md repps-gradient-text tabular-nums">
                    {teamScore ? teamScore.total.toLocaleString() : "—"}
                  </p>
                  <p className="text-caption text-ink-muted">pts</p>
                </div>
                {teamScore && teamScore.total > 0 && (
                  <div className="flex flex-col gap-0.5 mt-2">
                    <span className="text-micro text-ink-secondary tabular-nums">{teamScore.baseReps.toLocaleString()} base</span>
                    {(teamScore.streakBonus + teamScore.teamStreakBonus) > 0 && (
                      <span className="text-micro text-blue-400 tabular-nums">+{(teamScore.streakBonus + teamScore.teamStreakBonus).toLocaleString()} streak bonus</span>
                    )}
                    {teamScore.multiplied > 0 && (
                      <span className="text-micro text-emerald-400 tabular-nums">+{teamScore.multiplied.toLocaleString()} team multiplier</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Team streak */}
      <div className="bg-bg-surface rounded-lg p-4 mb-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <p className="text-micro text-ink-muted uppercase tracking-wide">Team Streak</p>
            <div className="flex items-center gap-2 mt-1">
              {teamStreak.current > 0 && (
                <img src="/Repps-Pumped-Yellow.png" alt="streak" className="w-8 h-8 object-contain" />
              )}
              <div className="flex items-baseline gap-1.5">
                <p className="text-display-md tabular-nums" style={{ color: "#F5C518" }}>
                  {teamStreak.current}
                </p>
                <p className="text-caption text-ink-muted">
                  {teamStreak.current === 1 ? "day" : "days"}
                </p>
              </div>
            </div>
          </div>
          <div className="w-px bg-divider" />
          <div className="flex-1">
            <p className="text-micro text-ink-muted uppercase tracking-wide">Longest</p>
            <div className="flex items-baseline gap-1.5 mt-1">
              <p className="text-display-md text-ink-primary tabular-nums">
                {teamStreak.longest}
              </p>
              <p className="text-caption text-ink-muted">
                {teamStreak.longest === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
        </div>
        {(() => {
          const memberCount = members.length;
          const maxLevel = 11;
          const streak = teamStreak.current;
          const level = streak === 0 ? 0 : Math.min(maxLevel, Math.floor((streak - 1) / 10) + 1);
          const bonusPerRep = level * memberCount;
          return (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-micro uppercase tracking-wide" style={{ color: level > 0 ? "#F5C518" : undefined }}>{level > 0 ? `Level ${level}` : "Level 0"}</span>
                <span className="text-micro font-semibold" style={{ color: level > 0 ? "#F5C518" : undefined }}>{bonusPerRep > 0 ? `+${bonusPerRep}/rep` : "+0/rep"}</span>
              </div>
              <div className="flex items-center gap-1">
                {Array.from({ length: maxLevel }, (_, i) => {
                  const lvl = i + 1;
                  const filled = lvl <= level;
                  return (
                    <div key={lvl} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full h-2.5 rounded-full transition-all duration-300"
                        style={{
                          background: filled ? `linear-gradient(90deg, #F5C518, #FFD700)` : undefined,
                          opacity: filled ? 0.4 + 0.6 * (lvl / maxLevel) : 1,
                        }}
                        {...(!filled && { className: "w-full h-2.5 rounded-full bg-bg-elevated" })}
                      />
                      <span className={`text-[8px] tabular-nums mt-0.5 ${lvl <= level ? "" : "text-ink-muted"}`} style={lvl <= level ? { color: "#F5C518" } : undefined}>
                        {lvl * 10}d
                      </span>
                    </div>
                  );
                })}
              </div>
              {streak === 0 ? (
                <p className="text-caption text-ink-muted mt-2">Do your reps today to start a team streak!</p>
              ) : level < maxLevel ? (
                <p className="text-caption text-ink-muted mt-2">
                  {(() => {
                    const nextMilestone = Math.ceil((streak + 1) / 10) * 10;
                    const daysToNext = nextMilestone - streak;
                    const nextLevel = Math.min(maxLevel, level + 1);
                    return daysToNext <= 3
                      ? <span style={{ color: "#F5C518" }}>{daysToNext === 1 ? "1 day" : `${daysToNext} days`} to level {nextLevel} (+{nextLevel * memberCount}/rep)!</span>
                      : <>Next level at {nextMilestone}d streak (+{nextLevel * memberCount}/rep)</>
                  })()}
                </p>
              ) : (
                <p className="text-caption mt-2" style={{ color: "#F5C518" }}>Max bonus level reached!</p>
              )}
            </div>
          );
        })()}
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
                <div className="w-10 h-10 rounded-full bg-avatar-bg flex items-center justify-center flex-shrink-0">
                  <span className="text-body-lg font-bold text-avatar-text">
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
                {m.today_total > 0 && (
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-micro text-ink-secondary tabular-nums">{m.today_base} base</span>
                    {m.today_daily_multiplied > m.today_base && (
                      <span className="text-micro text-emerald-400 tabular-nums">×3</span>
                    )}
                    {m.today_streak_bonus > 0 && (
                      <span className="text-micro text-blue-400 tabular-nums">+{m.today_streak_bonus} streak</span>
                    )}
                    {m.today_team_streak_bonus > 0 && (
                      <span className="text-micro text-emerald-400 tabular-nums">+{m.today_team_streak_bonus} team</span>
                    )}
                    <span className="text-micro text-success font-semibold tabular-nums">→ {m.today_total} pts</span>
                  </div>
                )}
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

      {/* Team last 7 days */}
      {teamDailyCounts.length > 0 && (
        <div className="mb-4">
          <WeeklyBarChart dailyCounts={teamDailyCounts} />
        </div>
      )}

      {/* Team activity heatmap */}
      {teamDailyCounts.length > 0 && (
        <div className="mb-4">
          <ActivityHeatmap
            dailyCounts={teamDailyCounts}
            months={3}
            maxScale={300}
            label="Team Activity"
            scaleLabel="300"
          />
        </div>
      )}

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
          All {members.length} members hit <span className="text-accent font-bold">{dailyTarget} repps</span> to unlock the <span className="text-accent font-bold">{members.length}x multiplier</span>
        </p>
        {team.status === "active" && (
          <div className="mt-3">
            {members.every(m => m.today_count >= dailyTarget) ? (
              <p className="text-caption text-success font-semibold">{members.length}x multiplier active today</p>
            ) : (
              <p className="text-caption text-ink-muted">
                {members.filter(m => m.today_count >= dailyTarget).length}/{members.length} members hit target today
              </p>
            )}
          </div>
        )}
      </div>

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
              <p className="text-body-lg text-ink-primary font-bold">Maximize Your Repp Score</p>
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

              {/* Daily Nx */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-accent flex-shrink-0">
                    <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
                  </svg>
                  <p className="text-caption text-ink-primary font-bold">Daily Team Bonus ({members.length}x)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  When all team members hit <span className="font-semibold">{dailyTarget}+ repps</span> in a day, everyone's base points are multiplied by the team size (<span className="text-accent font-bold">{members.length}x</span>). Add a 3rd member to go from 2x to 3x.
                </p>
              </div>

              {/* Weekly 2x */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-accent flex-shrink-0">
                    <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
                  </svg>
                  <p className="text-caption text-ink-primary font-bold">Weekly Team Bonus (2x)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  If all members hit the daily target on at least <span className="font-semibold">5 of 7 days</span> in a week, the whole week's points are <span className="text-accent font-bold">doubled</span>. Stacks with the daily bonus — a perfect week with 3 members = <span className="text-accent font-bold">6x</span>.
                </p>
              </div>

              {/* Individual streak */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-accent flex-shrink-0">
                    <path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13.01 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z"/>
                  </svg>
                  <p className="text-caption text-ink-primary font-bold">Individual Streak (+1 → +11)</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  Hit the daily target on consecutive days to build your streak. Starting day 2, earn <span className="font-semibold">+1 bonus per day</span>. Every 10 days it escalates by +1, capping at <span className="text-accent font-bold">+11/day</span> (day 101+). Miss a day? Streak resets to zero.
                </p>
              </div>

              {/* Team streak */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-accent flex-shrink-0">
                    <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
                  </svg>
                  <p className="text-caption text-ink-primary font-bold">Team Streak (+{members.length} → +{members.length * 11})</p>
                </div>
                <p className="text-caption text-ink-secondary">
                  When <span className="font-semibold">all members</span> hit the target on consecutive days, the team streak grows. Starts at <span className="font-semibold">+{members.length}/day per member</span>, escalating by +{members.length} every 10 days, capping at <span className="text-accent font-bold">+{members.length * 11}/day</span>. If anyone misses, the whole team streak resets.
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
                    <p className="text-micro text-accent uppercase tracking-wide mb-1">With Team ({members.length})</p>
                    <p className="text-display-sm text-accent font-bold">{members.length === 3 ? "1,854" : "1,236"}</p>
                    <p className="text-micro text-ink-muted">pts</p>
                    <p className="text-micro text-accent font-semibold mt-1">{members.length === 3 ? "12.4x" : "8.2x"} return</p>
                  </div>
                </div>

                <p className="text-micro text-ink-secondary mt-3 text-center">
                  Same 150 burpees — a team that shows up together scores <span className="text-accent font-bold">{members.length === 3 ? "~9x" : "~6x"} more</span>
                </p>
              </div>

              {/* Full breakdown table */}
              <div>
                <p className="text-caption text-ink-primary font-bold mb-1">How Points Build (with team)</p>
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                    <span className="text-blue-400 font-semibold">Individual</span>
                  </span>
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-emerald-400 font-semibold">Team</span>
                  </span>
                </div>
                <div className="bg-bg-surface rounded-lg overflow-hidden overflow-x-auto">
                  <table className="w-full text-[10px] tabular-nums">
                    <thead>
                      <tr className="border-b border-bg-elevated">
                        <th className="px-1.5 py-1.5 text-left text-ink-muted font-bold">Day</th>
                        <th className="px-1.5 py-1.5 text-right text-blue-400 font-bold">Reps</th>
                        <th className="px-1.5 py-1.5 text-right text-emerald-400 font-bold">{members.length}x</th>
                        <th className="px-1.5 py-1.5 text-right text-blue-400 font-bold">Str</th>
                        <th className="px-1.5 py-1.5 text-right text-emerald-400 font-bold">TStr</th>
                        <th className="px-1.5 py-1.5 text-right text-emerald-400 font-bold">Wk2x</th>
                        <th className="px-1.5 py-1.5 text-right text-ink-primary font-bold">Tot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { day: 1,  reps: 5, indStr: 0, teamStrTier: 0, wk: false },
                        { day: 2,  reps: 5, indStr: 1, teamStrTier: 1, wk: false },
                        { day: 7,  reps: 5, indStr: 1, teamStrTier: 1, wk: true },
                        { day: 11, reps: 5, indStr: 2, teamStrTier: 2, wk: false },
                        { day: 14, reps: 5, indStr: 2, teamStrTier: 2, wk: true },
                        { day: 21, reps: 5, indStr: 3, teamStrTier: 3, wk: true },
                        { day: 30, reps: 5, indStr: 3, teamStrTier: 3, wk: false },
                      ].map((r) => {
                        const n = members.length;
                        const teamStr = r.teamStrTier * n;
                        const dailyMult = r.reps * n;
                        const preMult = dailyMult + r.indStr + teamStr;
                        const total = r.wk ? preMult * 2 : preMult;
                        return (
                          <tr key={r.day} className="border-b border-bg-elevated/50">
                            <td className="px-1.5 py-1.5 text-ink-secondary">{r.day}</td>
                            <td className="px-1.5 py-1.5 text-right text-blue-400">{r.reps}</td>
                            <td className="px-1.5 py-1.5 text-right text-emerald-400">{dailyMult}</td>
                            <td className="px-1.5 py-1.5 text-right text-blue-400">{r.indStr > 0 ? `+${r.indStr}` : "—"}</td>
                            <td className="px-1.5 py-1.5 text-right text-emerald-400">{teamStr > 0 ? `+${teamStr}` : "—"}</td>
                            <td className="px-1.5 py-1.5 text-right text-emerald-400">{r.wk ? "×2" : "—"}</td>
                            <td className="px-1.5 py-1.5 text-right text-ink-primary font-bold">{total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-col gap-0.5 text-[10px] text-ink-muted">
                  <p><span className="text-emerald-400 font-semibold">{members.length}x</span> = daily team bonus (all {members.length} hit {dailyTarget}). <span className="text-blue-400 font-semibold">Str</span> = your streak bonus. <span className="text-emerald-400 font-semibold">TStr</span> = team streak bonus.</p>
                  <p><span className="text-emerald-400 font-semibold">Wk2x</span> = weekly bonus (5/7 days hit). Streaks escalate every 10 days.</p>
                </div>
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
