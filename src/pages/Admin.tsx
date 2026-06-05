import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams } from "react-router-dom";
import AdminFeatures from "../components/admin/AdminFeatures";
import AdminBugs from "../components/admin/AdminBugs";
import AdminComments from "../components/admin/AdminComments";

type Theme = "orange" | "blue" | "yellow";
type EngineVersion = "v1" | "v2" | "v3";
type AdminTab = "dashboard" | "features" | "bugs" | "comments";

interface Stats {
  totalReps: number;
  totalUsers: number;
  totalTeams: number;
  activeEvents: number;
}

interface ModelInfo {
  id: EngineVersion;
  name: string;
  subtitle: string;
  description: string;
  features: string[];
  stateMachine: string;
  accuracy: string;
  cameraSupport: string;
}

const SUPER_ADMINS = ["superflyasia@gmail.com"];

const TABS: { id: AdminTab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "features", label: "Features" },
  { id: "bugs", label: "Bugs" },
  { id: "comments", label: "Comments" },
];

const MODELS: ModelInfo[] = [
  {
    id: "v1",
    name: "V1 — Height Ratio",
    subtitle: "Original detection engine",
    description:
      "Simple 2-state machine using height-ratio tracking. Measures the ratio of nose-to-ankle height vs. calibrated standing height. When the ratio drops below the low threshold and returns above the high threshold, a rep is counted.",
    features: [
      "2-state machine (HIGH → LOW → HIGH)",
      "Height-ratio based detection",
      "Fixed thresholds (high: 0.72, low: 0.58)",
      "30-frame calibration period",
      "4-frame smoothing window",
      "150ms minimum low-dwell guard",
    ],
    stateMachine: "HIGH ↔ LOW",
    accuracy: "Good — works well for front-facing camera with consistent form",
    cameraSupport: "Front camera only",
  },
  {
    id: "v2",
    name: "V2 — Multi-State + Angle Detection",
    subtitle: "Enhanced detection engine",
    description:
      "Advanced 4-state machine with auto camera angle detection, joint angle calculations, and pose validation. Automatically detects front vs. side camera angle and applies optimized thresholds for each. Includes a stability guard to reject jitter during calibration.",
    features: [
      "4-state machine (STANDING → DESCENDING → DOWN → ASCENDING)",
      "Auto front/side camera angle detection",
      "1-second stability guard before calibration",
      "Joint angle calculations (hip, knee, torso)",
      "Pose validation to reject squats",
      "Separate front & side thresholds",
      "Nose-ankle ratio check for DOWN state",
      "1.5s minimum duration guard",
    ],
    stateMachine: "STANDING → DESCENDING → DOWN → ASCENDING",
    accuracy: "Better — rejects false positives, handles side view",
    cameraSupport: "Front + Side camera (auto-detected)",
  },
  {
    id: "v3",
    name: "V3 — Phase Verification + Audio Coaching",
    subtitle: "Full burpee verification with audio feedback (default)",
    description:
      "5-phase state machine that verifies each stage of the burpee: hinge, bottom/floor contact, drive, rise, and stand. Includes per-phase rejection with audio coaching cues, difficulty levels, and escalating feedback for repeated mistakes.",
    features: [
      "5-phase machine (READY → HINGING → BOTTOM → DRIVING → RISING)",
      "4 difficulty levels (Casual, Standard, Athlete, Elite)",
      "Audio rejection cues with priority queue",
      "Escalated feedback on consecutive failures",
      "Encouragement at clean rep streaks (3, 5, 10)",
      "Mid-movement coaching (keep going, push up, get up)",
      "Plank, floor contact, jump, and tuck verification",
      "Full-screen color flash feedback for distance viewing",
    ],
    stateMachine: "READY → HINGING → BOTTOM → DRIVING → RISING",
    accuracy: "Best — per-phase verification, fewer false positives",
    cameraSupport: "Front + Side camera (auto-detected)",
  },
];

const THEMES: { id: Theme; label: string; primary: string; secondary: string }[] = [
  { id: "orange", label: "Orange", primary: "#FF9B2F", secondary: "#FFC857" },
  { id: "blue", label: "Blue", primary: "#2D7AFF", secondary: "#5EEDFF" },
  { id: "yellow", label: "Yellow", primary: "#FFD600", secondary: "#FFE857" },
];

export default function Admin() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab") as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(
    tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : "dashboard"
  );

  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [stats, setStats] = useState<Stats>({ totalReps: 0, totalUsers: 0, totalTeams: 0, activeEvents: 0 });
  const [activeEngine, setActiveEngine] = useState<EngineVersion>("v2");
  const [selectedTheme, setSelectedTheme] = useState<Theme>("orange");
  const [saving, setSaving] = useState<string | null>(null);
  const [globalTarget, setGlobalTarget] = useState("2000");
  const [globalTargetDate, setGlobalTargetDate] = useState("2026-06-06");
  const [globalTargetLabel, setGlobalTargetLabel] = useState("2,000 burpees by June 6, 2026");
  const [consistencyThreshold, setConsistencyThreshold] = useState("30");
  const [consistencyDaysRequired, setConsistencyDaysRequired] = useState("5");

  function switchTab(tab: AdminTab) {
    setActiveTab(tab);
    setSearchParams(tab === "dashboard" ? {} : { tab });
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCheckingAuth(false);
      return;
    }
    const email = user.email ?? "";
    if (SUPER_ADMINS.includes(email)) {
      setAuthorized(true);
    }
    setCheckingAuth(false);
  }, [user, authLoading]);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["detection_engine", "theme", "global_target", "target_date", "target_label", "consistency_daily_threshold", "consistency_weekly_days_required"]);
    if (data) {
      for (const row of data) {
        if (row.key === "detection_engine") setActiveEngine(row.value as EngineVersion);
        if (row.key === "theme") setSelectedTheme(row.value as Theme);
        if (row.key === "global_target") setGlobalTarget(row.value);
        if (row.key === "target_date") setGlobalTargetDate(row.value);
        if (row.key === "target_label") setGlobalTargetLabel(row.value);
        if (row.key === "consistency_daily_threshold") setConsistencyThreshold(row.value);
        if (row.key === "consistency_weekly_days_required") setConsistencyDaysRequired(row.value);
      }
    }
  }, []);

  const loadStats = useCallback(async () => {
    const [reps, users, teams, events] = await Promise.all([
      supabase.from("reps").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("teams").select("id", { count: "exact", head: true }).neq("status", "disbanded"),
      supabase.from("events").select("id", { count: "exact", head: true }).in("status", ["announced", "active"]),
    ]);
    setStats({
      totalReps: reps.count ?? 0,
      totalUsers: users.count ?? 0,
      totalTeams: teams.count ?? 0,
      activeEvents: events.count ?? 0,
    });
  }, []);

  useEffect(() => {
    if (!authorized) return;
    loadSettings();
    loadStats();
  }, [authorized, loadSettings, loadStats]);

  async function upsertSetting(key: string, value: string) {
    setSaving(key);
    const { error } = await supabase
      .from("settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.error("Failed to save setting:", error);
    }
    setSaving(null);
  }

  async function handleEngineSelect(engine: EngineVersion) {
    setActiveEngine(engine);
    await upsertSetting("detection_engine", engine);
  }

  async function handleThemeSelect(theme: Theme) {
    setSelectedTheme(theme);
    await upsertSetting("theme", theme);
  }

  if (checkingAuth || authLoading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="text-ink-muted text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-ink-primary">Admin Access Required</h1>
          <p className="text-ink-muted text-sm">Sign in to access the admin dashboard.</p>
          <button
            onClick={() => navigate("/")}
            className="repps-gradient text-ink-inverse font-semibold px-6 py-3 rounded-xl text-sm"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-ink-primary">Access Denied</h1>
          <p className="text-ink-muted text-sm">
            You don't have super admin privileges.
          </p>
          <button
            onClick={() => navigate("/home")}
            className="text-accent font-semibold text-sm underline"
          >
            Back to App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-bg-elevated/80 backdrop-blur-xl border-b border-divider">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink-primary">REPPs Admin</h1>
            <p className="text-xs text-ink-muted mt-0.5">
              Super Admin — {profile?.name ?? user.email}
            </p>
          </div>
          <button
            onClick={() => navigate("/home")}
            className="text-sm text-accent font-medium hover:opacity-80 transition-opacity"
          >
            Back to App
          </button>
        </div>
        {/* Tab navigation */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto pb-0 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-accent text-accent"
                    : "border-transparent text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20">
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            {/* Stats Overview */}
            <section>
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-4">
                Platform Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total Repps" value={stats.totalReps.toLocaleString()} />
                <StatCard label="Users" value={stats.totalUsers.toLocaleString()} />
                <StatCard label="Teams" value={stats.totalTeams.toLocaleString()} />
                <StatCard label="Active Events" value={stats.activeEvents.toLocaleString()} />
              </div>
            </section>

            {/* Global Target */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider">
                  Global Target
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Set the platform-wide burpee target and deadline. Displayed on home and events.
                </p>
              </div>
              <div className="bg-bg-surface rounded-2xl border border-divider p-5 space-y-4">
                <div>
                  <label className="text-xs font-medium text-ink-secondary block mb-1.5">
                    Target Reps
                  </label>
                  <input
                    type="number"
                    value={globalTarget}
                    onChange={(e) => setGlobalTarget(e.target.value)}
                    onBlur={() => upsertSetting("global_target", globalTarget)}
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-secondary block mb-1.5">
                    Target Date
                  </label>
                  <input
                    type="date"
                    value={globalTargetDate}
                    onChange={(e) => {
                      setGlobalTargetDate(e.target.value);
                      upsertSetting("target_date", e.target.value);
                    }}
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-secondary block mb-1.5">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={globalTargetLabel}
                    onChange={(e) => setGlobalTargetLabel(e.target.value)}
                    onBlur={() => upsertSetting("target_label", globalTargetLabel)}
                    placeholder="e.g. 2,000 burpees by June 6, 2026"
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="pt-2 flex items-center gap-3">
                  <div className="flex-1 h-3 bg-bg-input rounded-pill overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-pill transition-all duration-300 ease-apple"
                      style={{ width: `${Math.min(100, (stats.totalReps / Math.max(1, Number(globalTarget))) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap">
                    {stats.totalReps.toLocaleString()} / {Number(globalTarget).toLocaleString()}
                  </span>
                </div>
              </div>
            </section>

            {/* Leaderboard Settings */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider">
                  Leaderboard
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Consistency metric thresholds. A qualifying day needs at least the daily threshold reps.
                  A qualifying week needs at least the required number of qualifying days.
                </p>
              </div>
              <div className="bg-bg-surface rounded-2xl border border-divider p-5 space-y-4">
                <div>
                  <label className="text-xs font-medium text-ink-secondary block mb-1.5">
                    Daily Threshold (reps per day to count)
                  </label>
                  <input
                    type="number"
                    value={consistencyThreshold}
                    onChange={(e) => setConsistencyThreshold(e.target.value)}
                    onBlur={() => upsertSetting("consistency_daily_threshold", consistencyThreshold)}
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-secondary block mb-1.5">
                    Weekly Days Required (qualifying days per week)
                  </label>
                  <input
                    type="number"
                    value={consistencyDaysRequired}
                    onChange={(e) => setConsistencyDaysRequired(e.target.value)}
                    onBlur={() => upsertSetting("consistency_weekly_days_required", consistencyDaysRequired)}
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>
            </section>

            {/* Detection Engine Selector */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider">
                  Verification Model
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Select which detection engine is used app-wide for burpee verification.
                  Changes take effect immediately for new sessions.
                </p>
              </div>
              <div className="space-y-3">
                {MODELS.map((model) => {
                  const isActive = activeEngine === model.id;
                  return (
                    <button
                      key={model.id}
                      onClick={() => handleEngineSelect(model.id)}
                      disabled={saving === "detection_engine"}
                      className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
                        isActive
                          ? "border-accent bg-accent/5"
                          : "border-divider bg-bg-surface hover:border-ink-muted/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-ink-primary">
                              {model.name}
                            </h3>
                            {isActive && (
                              <span className="repps-gradient text-ink-inverse text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-ink-muted mt-0.5">{model.subtitle}</p>
                        </div>
                        <div
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                            isActive ? "border-accent bg-accent" : "border-ink-muted/40"
                          }`}
                        >
                          {isActive && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-ink-secondary mt-3 leading-relaxed">
                        {model.description}
                      </p>

                      <div className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                        {model.features.map((f, i) => (
                          <div key={i} className="flex items-start gap-2 py-1">
                            <span className="text-accent text-xs mt-0.5 flex-shrink-0">
                              {isActive ? "●" : "○"}
                            </span>
                            <span className="text-xs text-ink-secondary">{f}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                        <div>
                          <span className="text-ink-muted">Accuracy: </span>
                          <span className="text-ink-primary font-medium">{model.accuracy}</span>
                        </div>
                        <div>
                          <span className="text-ink-muted">Camera: </span>
                          <span className="text-ink-primary font-medium">{model.cameraSupport}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Theme Switcher */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider">
                  App Theme
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Change the global accent color. All users see this change in real-time.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {THEMES.map((t) => {
                  const isActive = selectedTheme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleThemeSelect(t.id)}
                      disabled={saving === "theme"}
                      className={`rounded-2xl border-2 p-4 transition-all ${
                        isActive
                          ? "border-accent bg-accent/5"
                          : "border-divider bg-bg-surface hover:border-ink-muted/30"
                      }`}
                    >
                      <div className="flex justify-center mb-3">
                        <div
                          className="w-12 h-12 rounded-full"
                          style={{
                            background: `linear-gradient(135deg, ${t.primary} 0%, ${t.secondary} 100%)`,
                            boxShadow: isActive
                              ? `0 0 20px 4px ${t.primary}40`
                              : "none",
                          }}
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-ink-primary">{t.label}</p>
                        <p className="text-[10px] text-ink-muted mt-0.5 font-mono">
                          {t.primary}
                        </p>
                      </div>
                      {isActive && (
                        <div className="mt-2 flex justify-center">
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white"
                            style={{ background: t.primary }}
                          >
                            Active
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {activeTab === "features" && <AdminFeatures />}
        {activeTab === "bugs" && <AdminBugs />}
        {activeTab === "comments" && <AdminComments />}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-surface rounded-xl p-4 border border-divider">
      <p className="text-2xl font-bold text-ink-primary">{value}</p>
      <p className="text-xs text-ink-muted mt-1">{label}</p>
    </div>
  );
}
