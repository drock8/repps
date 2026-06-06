import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, type Profile } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import CountryPicker from "./CountryPicker";
import type { Country } from "../data/countries";

const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

interface ProfileGateProps {
  onComplete: () => void;
  onSkip: () => void;
}

export default function ProfileGate({ onComplete, onSkip }: ProfileGateProps) {
  const { profile, refreshProfile, updateProfile } = useAuth();

  const needsDob = !profile?.dob;
  const needsNationality = !profile?.nationality_code;
  const needsAvatar = !profile?.avatar_url;

  const [dobValue, setDobValue] = useState(profile?.dob || "");
  const [nationalityCode, setNationalityCode] = useState<string | null>(profile?.nationality_code || null);
  const [nationalityName, setNationalityName] = useState<string | null>(profile?.nationality_name || null);
  const [dobError, setDobError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Only JPEG, PNG, WebP, and GIF allowed");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError("Image must be under 5 MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

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
    setAvatarError("");

    const updates: Partial<Profile> = {};
    if (needsDob) updates.dob = dobValue;
    if (needsNationality) {
      updates.nationality_code = nationalityCode;
      updates.nationality_name = nationalityName;
    }

    if (avatarFile) {
      setUploadingAvatar(true);
      const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const contentType = avatarFile.type || "image/jpeg";
      const path = `${profile.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType });
      if (uploadError) {
        setAvatarError("Upload failed — try again");
        setSaving(false);
        setUploadingAvatar(false);
        return;
      }
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);
      updates.avatar_url = urlData.publicUrl;
      setUploadingAvatar(false);
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
  }, [profile, saving, needsDob, needsNationality, dobValue, nationalityCode, nationalityName, avatarFile, validateDob, refreshProfile, updateProfile, onComplete]);

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
          {needsAvatar && (
            <div className="flex flex-col items-center">
              <p className="text-micro text-ink-muted uppercase tracking-wide mb-2 self-start">Profile Photo</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative"
              >
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Preview"
                    className="w-20 h-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-bg-input flex items-center justify-center">
                    <span className="text-display-md text-ink-muted">
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-accent flex items-center justify-center shadow-lg">
                  {uploadingAvatar ? (
                    <div className="w-3.5 h-3.5 border-2 border-ink-inverse border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111315" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarSelect}
                className="hidden"
              />
              {avatarPreview && (
                <p className="text-caption text-accent mt-1">Looking good!</p>
              )}
              {avatarError && <p className="text-caption text-error mt-1">{avatarError}</p>}
            </div>
          )}

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
          {saving ? (uploadingAvatar ? "Uploading..." : "Saving...") : "Save & Join"}
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
