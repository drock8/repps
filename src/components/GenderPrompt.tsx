import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth, type Gender } from "../contexts/AuthContext";

const options: { label: string; value: Gender }[] = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
  { label: "Prefer not to say", value: "unspecified" },
];

export default function GenderPrompt() {
  const { profile, updateProfile } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleSelect = async (gender: Gender) => {
    if (!profile || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ gender, gender_set: true })
      .eq("id", profile.id);
    if (!error) {
      updateProfile({ gender, gender_set: true });
    } else {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h2 className="text-display-md text-center">How do you identify?</h2>
        <p className="text-body text-ink-secondary text-center mt-4">
          This determines which leaderboard you appear on. You can change this
          anytime in Profile.
        </p>

        <div className="flex flex-col gap-3 mt-10">
          {options.map((opt) => (
            <button
              key={opt.value}
              disabled={saving}
              onClick={() => handleSelect(opt.value)}
              className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple hover:bg-bg-elevated/80 active:scale-95 disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
