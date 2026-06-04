import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth, type Profile } from "../contexts/AuthContext";
import CountryPicker from "./CountryPicker";
import type { Country } from "../data/countries";

interface RewardSetting {
  dob: number;
  nationality: number;
}

interface ClaimedState {
  dob: boolean;
  nationality: boolean;
}

function CountUp({ target, duration = 600 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return <>{value}</>;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export default function BonusPointsBanner() {
  const { profile, refreshProfile, updateProfile } = useAuth();
  const reducedMotion = useReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<RewardSetting>({ dob: 100, nationality: 100 });
  const [claimed, setClaimed] = useState<ClaimedState>({ dob: false, nationality: false });
  const [loading, setLoading] = useState(true);

  const [dobValue, setDobValue] = useState("");
  const [nationalityCode, setNationalityCode] = useState<string | null>(null);
  const [nationalityName, setNationalityName] = useState<string | null>(null);

  const [savingDob, setSavingDob] = useState(false);
  const [savingNat, setSavingNat] = useState(false);
  const [dobError, setDobError] = useState("");
  const [natError, setNatError] = useState("");

  const [animatingDob, setAnimatingDob] = useState(false);
  const [animatingNat, setAnimatingNat] = useState(false);
  const [dobAwarded, setDobAwarded] = useState(0);
  const [natAwarded, setNatAwarded] = useState(0);

  useEffect(() => {
    if (!profile) return;
    setDobValue(profile.dob || "");
    setNationalityCode(profile.nationality_code);
    setNationalityName(profile.nationality_name);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const [settingsRes, claimedRes] = await Promise.all([
        supabase
          .from("settings")
          .select("key, value")
          .in("key", ["reward_profile_dob", "reward_profile_nationality"]),
        supabase
          .from("bonus_points")
          .select("label")
          .eq("user_id", profile!.id)
          .eq("category", "profile"),
      ]);

      if (settingsRes.data) {
        const s: RewardSetting = { dob: 100, nationality: 100 };
        for (const row of settingsRes.data) {
          if (row.key === "reward_profile_dob") s.dob = Number(row.value) || 100;
          if (row.key === "reward_profile_nationality") s.nationality = Number(row.value) || 100;
        }
        setSettings(s);
      }

      if (claimedRes.data) {
        const labels = claimedRes.data.map((r: { label: string }) => r.label);
        setClaimed({
          dob: labels.includes("dob"),
          nationality: labels.includes("nationality"),
        });
      }

      setLoading(false);
    }
    load();
  }, [profile]);

  const validateDob = useCallback((dateStr: string): string | null => {
    if (!dateStr) return "Please enter your date of birth";
    const dob = new Date(dateStr + "T00:00:00");
    if (isNaN(dob.getTime())) return "Invalid date";
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear() -
      (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    if (age < 13) return "Must be at least 13 years old";
    if (age > 120) return "Please enter a valid date";
    return null;
  }, []);

  const handleSaveDob = useCallback(async () => {
    if (!profile || savingDob) return;
    const err = validateDob(dobValue);
    if (err) { setDobError(err); return; }
    setDobError("");
    setSavingDob(true);

    const { error } = await supabase
      .from("profiles")
      .update({ dob: dobValue })
      .eq("id", profile.id);

    if (error) {
      setDobError("Failed to save — try again");
      setSavingDob(false);
      return;
    }

    updateProfile({ dob: dobValue } as Partial<Profile>);

    const { data: pts } = await supabase.rpc("claim_profile_reward", { p_field: "dob" });
    const awarded = typeof pts === "number" ? pts : 0;

    if (awarded > 0) {
      setDobAwarded(awarded);
      setAnimatingDob(true);
      setClaimed((prev) => ({ ...prev, dob: true }));
      setTimeout(() => setAnimatingDob(false), 1500);
    } else {
      setClaimed((prev) => ({ ...prev, dob: true }));
    }

    setSavingDob(false);
    await refreshProfile();
  }, [profile, dobValue, savingDob, validateDob, refreshProfile, updateProfile]);

  const handleSaveNationality = useCallback(async () => {
    if (!profile || savingNat || !nationalityCode || !nationalityName) return;
    setNatError("");
    setSavingNat(true);

    const { error } = await supabase
      .from("profiles")
      .update({ nationality_code: nationalityCode, nationality_name: nationalityName })
      .eq("id", profile.id);

    if (error) {
      setNatError("Failed to save — try again");
      setSavingNat(false);
      return;
    }

    updateProfile({ nationality_code: nationalityCode, nationality_name: nationalityName } as Partial<Profile>);

    const { data: pts } = await supabase.rpc("claim_profile_reward", { p_field: "nationality" });
    const awarded = typeof pts === "number" ? pts : 0;

    if (awarded > 0) {
      setNatAwarded(awarded);
      setAnimatingNat(true);
      setClaimed((prev) => ({ ...prev, nationality: true }));
      setTimeout(() => setAnimatingNat(false), 1500);
    } else {
      setClaimed((prev) => ({ ...prev, nationality: true }));
    }

    setSavingNat(false);
    await refreshProfile();
  }, [profile, nationalityCode, nationalityName, savingNat, refreshProfile, updateProfile]);

  if (!profile || loading) return null;

  const allClaimed = claimed.dob && claimed.nationality;
  const hasUnclaimed = !claimed.dob || !claimed.nationality;

  if (!hasUnclaimed && !animatingDob && !animatingNat) return null;

  return (
    <div className="bg-bg-surface rounded-lg overflow-hidden border-l-2 border-accent">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
          {allClaimed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" />
              <polyline points="12 15 12 3" />
              <path d="M4 8l4-4h8l4 4" />
            </svg>
          )}
        </div>
        <div className="flex-1 text-left">
          <p className="text-body-lg font-semibold text-ink-primary">
            {allClaimed ? "All bonus points claimed" : "Earn Bonus Points"}
          </p>
          {!allClaimed && (
            <p className="text-caption text-ink-secondary mt-0.5">
              +{((!claimed.dob ? settings.dob : 0) + (!claimed.nationality ? settings.nationality : 0)).toLocaleString()} pts available
            </p>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          {/* DOB field */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-micro text-ink-muted uppercase tracking-wide">Date of Birth</p>
              {claimed.dob ? (
                <span className="flex items-center gap-1 text-micro text-success font-semibold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Claimed
                </span>
              ) : (
                <span className={`text-micro font-bold tabular-nums ${animatingDob ? "text-accent" : "text-purple-400"}`}>
                  {animatingDob ? (
                    <span className="inline-flex items-center gap-0.5">
                      +<CountUp target={dobAwarded} />
                      <span className={reducedMotion ? "" : "animate-pulse"}> pts</span>
                    </span>
                  ) : (
                    `+${settings.dob} pts`
                  )}
                </span>
              )}
            </div>

            {animatingDob && !reducedMotion && (
              <div className="mb-2 h-0.5 rounded-full bg-accent/30 overflow-hidden">
                <div className="h-full bg-accent animate-[glow-sweep_1.5s_ease-out_forwards] rounded-full" />
              </div>
            )}

            <input
              type="date"
              value={dobValue}
              onChange={(e) => { setDobValue(e.target.value); setDobError(""); }}
              disabled={claimed.dob || savingDob}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            />
            {dobError && <p className="text-caption text-error mt-1">{dobError}</p>}

            {!claimed.dob && dobValue && (
              <button
                onClick={handleSaveDob}
                disabled={savingDob}
                className="mt-2 w-full bg-accent text-ink-inverse font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {savingDob ? "Saving..." : "Save & Claim"}
              </button>
            )}
          </div>

          {/* Nationality field */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-micro text-ink-muted uppercase tracking-wide">Nationality</p>
              {claimed.nationality ? (
                <span className="flex items-center gap-1 text-micro text-success font-semibold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Claimed
                </span>
              ) : (
                <span className={`text-micro font-bold tabular-nums ${animatingNat ? "text-accent" : "text-purple-400"}`}>
                  {animatingNat ? (
                    <span className="inline-flex items-center gap-0.5">
                      +<CountUp target={natAwarded} />
                      <span className={reducedMotion ? "" : "animate-pulse"}> pts</span>
                    </span>
                  ) : (
                    `+${settings.nationality} pts`
                  )}
                </span>
              )}
            </div>

            {animatingNat && !reducedMotion && (
              <div className="mb-2 h-0.5 rounded-full bg-accent/30 overflow-hidden">
                <div className="h-full bg-accent animate-[glow-sweep_1.5s_ease-out_forwards] rounded-full" />
              </div>
            )}

            <CountryPicker
              value={nationalityCode}
              onChange={(c: Country) => {
                setNationalityCode(c.code);
                setNationalityName(c.name);
                setNatError("");
              }}
              disabled={claimed.nationality || savingNat}
            />
            {natError && <p className="text-caption text-error mt-1">{natError}</p>}

            {!claimed.nationality && nationalityCode && (
              <button
                onClick={handleSaveNationality}
                disabled={savingNat}
                className="mt-2 w-full bg-accent text-ink-inverse font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                {savingNat ? "Saving..." : "Save & Claim"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
