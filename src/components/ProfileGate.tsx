import { useState, useEffect, useCallback } from "react";
import { useAuth, type Profile } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import CountryPicker from "./CountryPicker";
import type { Country } from "../data/countries";

interface ProfileGateProps {
  onComplete: () => void;
  onSkip: () => void;
}

export default function ProfileGate({ onComplete, onSkip }: ProfileGateProps) {
  const { profile, refreshProfile, updateProfile } = useAuth();

  const needsDob = !profile?.dob;
  const needsNationality = !profile?.nationality_code;

  const [dobValue, setDobValue] = useState(profile?.dob || "");
  const [nationalityCode, setNationalityCode] = useState<string | null>(profile?.nationality_code || null);
  const [nationalityName, setNationalityName] = useState<string | null>(profile?.nationality_name || null);
  const [dobError, setDobError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [bonusAvailable, setBonusAvailable] = useState(0);

  useEffect(() => {
    if (!profile) return;
    async function loadBonuses() {
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

      let total = 0;
      const claimed = new Set((claimedRes.data || []).map((r: { label: string }) => r.label));
      const settings: Record<string, number> = {};
      for (const row of settingsRes.data || []) {
        settings[row.key] = Number(row.value) || 100;
      }

      if (needsDob && !claimed.has("dob")) total += settings.reward_profile_dob || 100;
      if (needsNationality && !claimed.has("nationality")) total += settings.reward_profile_nationality || 100;
      setBonusAvailable(total);
    }
    loadBonuses();
  }, [profile, needsDob, needsNationality]);

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

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const canSubmit =
    (!needsDob || dobValue) &&
    (!needsNationality || nationalityCode);

  const handleSave = useCallback(async () => {
    if (!profile || saving) return;

    if (needsDob) {
      const err = validateDob(dobValue);
      if (err) { setDobError(err); return; }
    }
    if (needsNationality && !nationalityCode) {
      setError("Please select your nationality");
      return;
    }

    setSaving(true);
    setError("");
    setDobError("");

    const updates: Partial<Profile> = {};
    if (needsDob) updates.dob = dobValue;
    if (needsNationality) {
      updates.nationality_code = nationalityCode;
      updates.nationality_name = nationalityName;
    }

    const { error: dbError } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profile.id);

    if (dbError) {
      setError("Failed to save — try again");
      setSaving(false);
      return;
    }

    updateProfile(updates);

    if (needsDob) await supabase.rpc("claim_profile_reward", { p_field: "dob" });
    if (needsNationality) await supabase.rpc("claim_profile_reward", { p_field: "nationality" });

    await refreshProfile();
    setSaving(false);
    onComplete();
  }, [profile, saving, needsDob, needsNationality, dobValue, nationalityCode, nationalityName, validateDob, refreshProfile, updateProfile, onComplete]);

  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/90 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-6 pb-8 animate-[slide-up_300ms_ease-apple]">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 className="text-headline text-ink-primary">Complete Your Profile</h2>
          <p className="text-body text-ink-secondary mt-1">Required to compete</p>
        </div>

        <div className="flex flex-col gap-4">
          {needsDob && (
            <div>
              <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Date of Birth</p>
              <input
                type="date"
                value={dobValue}
                onChange={(e) => { setDobValue(e.target.value); setDobError(""); }}
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
              {dobError && <p className="text-caption text-error mt-1">{dobError}</p>}
            </div>
          )}

          {needsNationality && (
            <div>
              <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Nationality</p>
              <CountryPicker
                value={nationalityCode}
                onChange={(c: Country) => {
                  setNationalityCode(c.code);
                  setNationalityName(c.name);
                  setError("");
                }}
              />
            </div>
          )}
        </div>

        {bonusAvailable > 0 && (
          <p className="text-caption text-accent font-semibold text-center mt-4">
            +{bonusAvailable} bonus pts
          </p>
        )}

        {error && <p className="text-caption text-error text-center mt-3">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !canSubmit}
          className="w-full mt-5 bg-accent text-ink-inverse font-semibold text-body-lg rounded-pill py-4 transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save & Join"}
        </button>

        <button
          onClick={onSkip}
          className="w-full mt-3 text-ink-muted text-body py-2 transition-colors duration-200 ease-apple active:text-ink-secondary"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
