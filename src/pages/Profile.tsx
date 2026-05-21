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
      <div>
        <h1 className="text-display-md">Profile</h1>
        <p className="text-body text-ink-muted mt-4">
          Sign in to see your profile
        </p>
        <button
          onClick={signInWithGoogle}
          className="mt-6 bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          Sign in with Google
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
    <div>
      <h1 className="text-display-md">Profile</h1>

      {/* Avatar */}
      <div className="flex justify-center mt-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative group"
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
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200">
            <span className="text-micro text-ink-primary uppercase">
              {uploadingAvatar ? "..." : "Edit"}
            </span>
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

      {/* Name card */}
      {editingName ? (
        <div className="bg-bg-surface rounded-lg p-4 mt-3">
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
          className="w-full text-left bg-bg-surface rounded-lg p-4 mt-3 transition-colors duration-200 ease-apple active:bg-bg-elevated"
        >
          <p className="text-micro text-ink-muted uppercase tracking-wide">
            Name
          </p>
          <p className="text-headline mt-1">{profile.name}</p>
        </button>
      )}

      {/* Gender card */}
      {editingGender ? (
        <div className="bg-bg-surface rounded-lg p-4 mt-2">
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
          className="w-full text-left bg-bg-surface rounded-lg p-4 mt-2 transition-colors duration-200 ease-apple active:bg-bg-elevated"
        >
          <p className="text-micro text-ink-muted uppercase tracking-wide">
            Gender
          </p>
          <p className="text-headline mt-1">{formatGender(profile.gender)}</p>
        </button>
      )}

      {/* Stats */}
      <div className="flex gap-2 mt-3">
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

      {/* Sign out */}
      <button
        onClick={signOut}
        className="mt-6 w-full bg-bg-elevated text-ink-primary font-semibold text-body rounded-pill py-3 px-6 transition-all duration-200 ease-apple active:scale-95"
      >
        Sign out
      </button>
    </div>
  );
}
