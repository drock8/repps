import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth, type Gender } from "../contexts/AuthContext";

const genderOptions: { label: string; value: Gender }[] = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
  { label: "Prefer not to say", value: "unspecified" },
];

function formatGender(gender: Gender): string {
  if (gender === "non_binary") return "Non-binary";
  if (gender === "unspecified") return "Prefer not to say";
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

export default function Profile() {
  const { profile, signInWithGoogle, signOut, refreshProfile } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingGender, setEditingGender] = useState(false);
  const [savingGender, setSavingGender] = useState(false);
  const [totalReps, setTotalReps] = useState<number | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from("reps")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .then(({ count }) => setTotalReps(count ?? 0));
  }, [profile]);

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <p className="text-body text-ink-muted mb-8">
          Sign in to see your profile
        </p>
        <button
          onClick={signInWithGoogle}
          className="w-32 h-32 rounded-full bg-accent text-ink-inverse font-bold text-[18px] flex items-center justify-center text-center leading-tight transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(255,200,87,0.4)]"
        >
          Sign in<br />with<br />Google
        </button>
      </div>
    );
  }

  const handleStartEditName = () => {
    setNameValue(profile.name);
    setNameError("");
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (trimmed.length > 50) {
      setNameError("Name must be 50 characters or less");
      return;
    }
    setSavingName(true);
    await supabase
      .from("profiles")
      .update({ name: trimmed })
      .eq("id", profile.id);
    await refreshProfile();
    setSavingName(false);
    setEditingName(false);
  };

  const handleSelectGender = async (gender: Gender) => {
    if (savingGender) return;
    setSavingGender(true);
    await supabase
      .from("profiles")
      .update({ gender, gender_set: true })
      .eq("id", profile.id);
    await refreshProfile();
    setSavingGender(false);
    setEditingGender(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const ext = file.name.split(".").pop();
    const path = `${profile.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      console.error("Avatar upload failed:", uploadError);
      setUploadingAvatar(false);
      return;
    }
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(path);
    const publicUrl = urlData.publicUrl + "?t=" + Date.now();
    await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", profile.id);
    await refreshProfile();
    setUploadingAvatar(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const memberSince = new Date(profile.created_at).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" }
  );

  return (
    <div className="flex flex-col">
      {/* Sign out icon top-right */}
      <div className="flex justify-end">
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-ink-muted transition-colors duration-200 ease-apple active:text-ink-primary"
          title="Sign out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      {/* Avatar with camera edit icon */}
      <div className="flex justify-center mt-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative"
        >
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name}
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
              <span className="text-display-md text-ink-inverse">
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
          onChange={handleAvatarUpload}
          className="hidden"
        />
      </div>

      {/* Cards — consistent 2-unit gap */}
      <div className="flex flex-col gap-2 mt-4">
        {/* Name card */}
        {editingName ? (
          <div className="bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Name
            </p>
            <input
              type="text"
              value={nameValue}
              onChange={(e) => {
                setNameValue(e.target.value);
                setNameError("");
              }}
              maxLength={50}
              autoFocus
              className="w-full mt-2 bg-bg-input text-ink-primary text-headline rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            {nameError && (
              <p className="text-caption text-error mt-2">{nameError}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="flex-1 bg-accent text-ink-inverse font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="flex-1 bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartEditName}
            className="w-full text-left bg-bg-surface rounded-lg p-4 transition-colors duration-200 ease-apple active:bg-bg-elevated"
          >
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Name
            </p>
            <p className="text-headline mt-1">{profile.name}</p>
          </button>
        )}

        {/* Gender card */}
        {editingGender ? (
          <div className="bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Gender
            </p>
            <div className="flex flex-col gap-2 mt-3">
              {genderOptions.map((opt) => (
                <button
                  key={opt.value}
                  disabled={savingGender}
                  onClick={() => handleSelectGender(opt.value)}
                  className={`w-full py-3 px-4 rounded-pill text-body-lg font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50 ${
                    profile.gender === opt.value
                      ? "bg-accent text-ink-inverse"
                      : "bg-bg-elevated text-ink-primary hover:bg-bg-elevated/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setEditingGender(false)}
              className="w-full mt-3 bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingGender(true)}
            className="w-full text-left bg-bg-surface rounded-lg p-4 transition-colors duration-200 ease-apple active:bg-bg-elevated"
          >
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Gender
            </p>
            <p className="text-headline mt-1">{formatGender(profile.gender)}</p>
          </button>
        )}

        {/* Stats side by side */}
        <div className="flex gap-2">
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Total Reps
            </p>
            <p className="text-display-lg text-accent mt-1 tabular-nums">
              {totalReps !== null ? totalReps.toLocaleString() : "—"}
            </p>
          </div>
          <div className="flex-1 bg-bg-surface rounded-lg p-4">
            <p className="text-micro text-ink-muted uppercase tracking-wide">
              Member Since
            </p>
            <p className="text-body mt-1">{memberSince}</p>
          </div>
        </div>
      </div>

      {/* Sign out button */}
      <div className="mt-6">
        <button
          onClick={signOut}
          className="w-full bg-bg-elevated text-ink-secondary font-semibold text-body rounded-pill py-3 px-6 transition-all duration-200 ease-apple active:scale-95"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
