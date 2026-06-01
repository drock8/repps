import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

const ADMIN_ID = "a8775e49-918b-4496-84a0-e2b542e5e4f3";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BANNER_SIZE = 5 * 1024 * 1024;

type Step = 1 | 2 | 3 | 4 | 5;

interface FormData {
  name: string;
  description: string;
  bannerFile: File | null;
  bannerPreview: string | null;
  category: "official" | "community";
  visibility: "public" | "invite_only";
  competition_mode: string;
  target_reps: string;
  scoring_method: "raw_reps" | "rep_score";
  max_participants: string;
  max_teams: string;
  starts_at: string;
  ends_at: string;
  prize_type: "bragging_rights" | "custom_prize";
  prize_description: string;
}

const COMPETITION_MODES = [
  {
    value: "global_target",
    label: "Global Target",
    description: "Everyone contributes to one goal",
    icon: "globe",
    hasTarget: true,
    isTeam: false,
  },
  {
    value: "individual_most",
    label: "Individual Most",
    description: "Whoever gets the most reps wins",
    icon: "person",
    hasTarget: false,
    isTeam: false,
  },
  {
    value: "individual_target",
    label: "Individual Target",
    description: "First to hit the target wins",
    icon: "person",
    hasTarget: true,
    isTeam: false,
  },
  {
    value: "team_most",
    label: "Team Most",
    description: "Team with the most combined reps wins",
    icon: "group",
    hasTarget: false,
    isTeam: true,
  },
  {
    value: "team_target",
    label: "Team Target",
    description: "First team to hit the target wins",
    icon: "group",
    hasTarget: true,
    isTeam: true,
  },
  {
    value: "team_vs_team",
    label: "Team vs Team",
    description: "Two teams go head to head",
    icon: "group",
    hasTarget: false,
    isTeam: true,
  },
];

function ModeIcon({ type }: { type: string }) {
  if (type === "globe") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }
  if (type === "person") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalDatetimeString(d);
}

function getDefaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 8);
  d.setHours(21, 0, 0, 0);
  return toLocalDatetimeString(d);
}

function toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(startStr: string, endStr: string): string {
  if (!startStr || !endStr) return "";
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (end <= start) return "End must be after start";
  const diff = end - start;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days === 0) return `Runs for ${hours} hour${hours !== 1 ? "s" : ""}`;
  if (hours === 0) return `Runs for ${days} day${days !== 1 ? "s" : ""}`;
  return `Runs for ${days} day${days !== 1 ? "s" : ""}, ${hours} hour${hours !== 1 ? "s" : ""}`;
}

const STEP_LABELS = ["Identity", "Competition", "Timing", "Prizes", "Review"];

export default function CreateEvent() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = profile?.id === ADMIN_ID;

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormData>({
    name: "",
    description: "",
    bannerFile: null,
    bannerPreview: null,
    category: "community",
    visibility: "public",
    competition_mode: "individual_most",
    target_reps: "",
    scoring_method: "raw_reps",
    max_participants: "",
    max_teams: "",
    starts_at: getDefaultStartDate(),
    ends_at: getDefaultEndDate(),
    prize_type: "bragging_rights",
    prize_description: "",
  });

  const update = (fields: Partial<FormData>) => setForm((prev) => ({ ...prev, ...fields }));

  const selectedMode = COMPETITION_MODES.find((m) => m.value === form.competition_mode)!;
  const needsTarget = selectedMode.hasTarget;
  const isTeamMode = selectedMode.isTeam;
  const hasTeam = !!profile?.team_id;

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError("Only JPEG, PNG, WebP, and GIF allowed");
      return;
    }
    if (file.size > MAX_BANNER_SIZE) {
      setError("Image must be under 5 MB");
      return;
    }
    setError("");
    const preview = URL.createObjectURL(file);
    update({ bannerFile: file, bannerPreview: preview });
  };

  const canAdvance = (s: Step): boolean => {
    if (s === 1) return form.name.trim().length >= 3 && form.name.trim().length <= 60;
    if (s === 2) {
      if (needsTarget && (!form.target_reps || parseInt(form.target_reps) <= 0)) return false;
      return true;
    }
    if (s === 3) {
      if (!form.starts_at || !form.ends_at) return false;
      return new Date(form.ends_at).getTime() > new Date(form.starts_at).getTime();
    }
    if (s === 4) {
      if (form.prize_type === "custom_prize" && !form.prize_description.trim()) return false;
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (step < 5) setStep((step + 1) as Step);
  };

  const handleBack = () => {
    if (step > 1) setStep((step - 1) as Step);
  };

  const uploadBanner = async (): Promise<string | null> => {
    if (!form.bannerFile || !profile) return null;
    const ext = form.bannerFile.name.split(".").pop();
    const path = `${profile.id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("event-banners")
      .upload(path, form.bannerFile, { upsert: true });
    if (uploadErr) throw uploadErr;
    const { data } = supabase.storage.from("event-banners").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async (announce: boolean) => {
    if (!profile) return;
    setSubmitting(true);
    setError("");

    try {
      let bannerUrl: string | null = null;
      if (form.bannerFile) {
        bannerUrl = await uploadBanner();
      }

      const params = {
        p_name: form.name.trim(),
        p_description: form.description.trim() || null,
        p_banner_url: bannerUrl,
        p_category: form.category,
        p_visibility: form.visibility,
        p_competition_mode: form.competition_mode,
        p_target_reps: needsTarget ? parseInt(form.target_reps) : null,
        p_scoring_method: form.scoring_method,
        p_max_participants: isTeamMode ? null : (form.max_participants ? parseInt(form.max_participants) : null),
        p_max_teams: isTeamMode ? (form.max_teams ? parseInt(form.max_teams) : null) : null,
        p_starts_at: new Date(form.starts_at).toISOString(),
        p_ends_at: new Date(form.ends_at).toISOString(),
        p_prize_type: form.prize_type,
        p_prize_description: form.prize_type === "custom_prize" ? form.prize_description.trim() : null,
      };

      const { data, error: rpcError } = await supabase.rpc("create_event", params);

      if (rpcError) {
        setError(rpcError.message);
        setSubmitting(false);
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Failed to create event");
        setSubmitting(false);
        return;
      }

      if (announce) {
        await supabase.rpc("announce_event", { p_event_id: data.event_id });
      }

      navigate(`/events/${data.event_id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Create Event</p>
        <p className="text-body text-ink-secondary text-center">Sign in to create an event</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Back */}
      <button
        onClick={() => (step === 1 ? navigate("/events") : handleBack())}
        className="flex items-center gap-1 text-caption text-ink-secondary self-start -mb-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {step === 1 ? "Events" : "Back"}
      </button>

      {/* Step indicator */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-pill transition-colors duration-200 ease-apple ${
                s <= step ? "bg-accent" : "bg-bg-input"
              }`}
            />
          ))}
        </div>
        <p className="text-micro text-ink-muted uppercase tracking-wide">
          Step {step} of 5 · {STEP_LABELS[step - 1]}
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="text-caption text-error bg-error/10 rounded-md px-3 py-2">{error}</p>
      )}

      {/* Step 1: Identity */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Event Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Weekend Warrior Challenge"
              maxLength={60}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-micro text-ink-muted mt-1">{form.name.length}/60</p>
          </div>

          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What's this event about? (optional)"
              maxLength={500}
              rows={3}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent resize-none"
            />
            <p className="text-micro text-ink-muted mt-1">{form.description.length}/500</p>
          </div>

          {/* Banner upload */}
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Banner Image</label>
            <button
              onClick={() => bannerInputRef.current?.click()}
              className="w-full h-32 bg-bg-input rounded-lg flex flex-col items-center justify-center gap-2 overflow-hidden transition-all duration-200 ease-apple active:scale-[0.98]"
            >
              {form.bannerPreview ? (
                <img src={form.bannerPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span className="text-caption text-ink-muted">Tap to upload banner</span>
                </>
              )}
            </button>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleBannerSelect}
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Category</label>
            <div className="flex gap-2">
              {isAdmin && (
                <button
                  onClick={() => update({ category: "official" })}
                  className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                    form.category === "official"
                      ? "bg-accent text-ink-inverse"
                      : "bg-bg-input text-ink-secondary"
                  }`}
                >
                  Official
                </button>
              )}
              <button
                onClick={() => update({ category: "community" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.category === "community"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Community
              </button>
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Visibility</label>
            <div className="flex gap-2">
              <button
                onClick={() => update({ visibility: "public" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.visibility === "public"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Public
              </button>
              <button
                onClick={() => update({ visibility: "invite_only" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.visibility === "invite_only"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Invite Only
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Competition */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-2">Competition Mode</label>
            <div className="flex flex-col gap-2">
              {COMPETITION_MODES.map((mode) => {
                const selected = form.competition_mode === mode.value;
                const needsTeamWarning = mode.isTeam && !hasTeam;
                return (
                  <button
                    key={mode.value}
                    onClick={() => update({ competition_mode: mode.value })}
                    className={`w-full p-3 rounded-lg text-left flex items-start gap-3 transition-all duration-200 ease-apple ${
                      selected
                        ? "bg-accent/15 ring-1 ring-accent"
                        : "bg-bg-surface"
                    }`}
                  >
                    <div className={`flex-shrink-0 mt-0.5 ${selected ? "text-accent" : "text-ink-muted"}`}>
                      <ModeIcon type={mode.icon} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-body font-semibold ${selected ? "text-accent" : "text-ink-primary"}`}>
                        {mode.label}
                      </p>
                      <p className="text-caption text-ink-muted mt-0.5">{mode.description}</p>
                      {needsTeamWarning && selected && (
                        <p className="text-micro text-error mt-1">You need an active team to create team events</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target reps */}
          {needsTarget && (
            <div>
              <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Target Reps</label>
              <input
                type="number"
                value={form.target_reps}
                onChange={(e) => update({ target_reps: e.target.value })}
                placeholder="e.g. 1000"
                min="1"
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}

          {/* Scoring method */}
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Scoring Method</label>
            <div className="flex gap-2">
              <button
                onClick={() => update({ scoring_method: "raw_reps" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.scoring_method === "raw_reps"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Raw Reps
              </button>
              <button
                onClick={() => update({ scoring_method: "rep_score" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.scoring_method === "rep_score"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Rep Score
              </button>
            </div>
          </div>

          {/* Max participants / teams */}
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">
              {isTeamMode ? "Max Teams" : "Max Participants"} (optional)
            </label>
            <input
              type="number"
              value={isTeamMode ? form.max_teams : form.max_participants}
              onChange={(e) =>
                update(isTeamMode ? { max_teams: e.target.value } : { max_participants: e.target.value })
              }
              placeholder="Unlimited"
              min="2"
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      )}

      {/* Step 3: Timing */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Start Date & Time</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => update({ starts_at: e.target.value })}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">End Date & Time</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => update({ ends_at: e.target.value })}
              min={form.starts_at}
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent [color-scheme:dark]"
            />
          </div>

          {form.starts_at && form.ends_at && (
            <div className="bg-bg-surface rounded-lg p-4">
              <p className={`text-body font-semibold ${
                new Date(form.ends_at).getTime() > new Date(form.starts_at).getTime()
                  ? "text-ink-primary"
                  : "text-error"
              }`}>
                {formatDuration(form.starts_at, form.ends_at)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Prizes */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Prize Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => update({ prize_type: "bragging_rights" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.prize_type === "bragging_rights"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Bragging Rights
              </button>
              <button
                onClick={() => update({ prize_type: "custom_prize" })}
                className={`flex-1 py-3 rounded-md text-caption font-semibold transition-colors duration-200 ease-apple ${
                  form.prize_type === "custom_prize"
                    ? "bg-accent text-ink-inverse"
                    : "bg-bg-input text-ink-secondary"
                }`}
              >
                Custom Prize
              </button>
            </div>
          </div>

          {form.prize_type === "custom_prize" && (
            <div>
              <label className="text-micro text-ink-muted uppercase tracking-wide block mb-1.5">Prize Description</label>
              <input
                type="text"
                value={form.prize_description}
                onChange={(e) => update({ prize_description: e.target.value })}
                placeholder="e.g. Winner gets a free smoothie"
                maxLength={200}
                className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 5: Review */}
      {step === 5 && (
        <div className="flex flex-col gap-4">
          <p className="text-headline text-ink-primary">Review Your Event</p>

          {form.bannerPreview && (
            <img src={form.bannerPreview} alt="" className="w-full h-32 object-cover rounded-lg" />
          )}

          <div className="bg-bg-surface rounded-lg p-4 flex flex-col gap-3">
            <ReviewRow label="Name" value={form.name} />
            {form.description && <ReviewRow label="Description" value={form.description} />}
            <ReviewRow label="Category" value={form.category === "official" ? "Official" : "Community"} />
            <ReviewRow label="Visibility" value={form.visibility === "public" ? "Public" : "Invite Only"} />
            <ReviewRow label="Mode" value={selectedMode.label} />
            {needsTarget && <ReviewRow label="Target" value={`${parseInt(form.target_reps).toLocaleString("en-US")} reps`} />}
            <ReviewRow label="Scoring" value={form.scoring_method === "rep_score" ? "Rep Score" : "Raw Reps"} />
            {(isTeamMode ? form.max_teams : form.max_participants) && (
              <ReviewRow
                label={isTeamMode ? "Max Teams" : "Max Participants"}
                value={isTeamMode ? form.max_teams : form.max_participants}
              />
            )}
            <ReviewRow
              label="Starts"
              value={new Date(form.starts_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
              })}
            />
            <ReviewRow
              label="Ends"
              value={new Date(form.ends_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
              })}
            />
            <ReviewRow label="Duration" value={formatDuration(form.starts_at, form.ends_at)} />
            <ReviewRow
              label="Prize"
              value={form.prize_type === "custom_prize" ? form.prize_description : "Bragging rights"}
            />
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex flex-col gap-3 mt-2">
        {step < 5 ? (
          <button
            onClick={handleNext}
            disabled={!canAdvance(step)}
            className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-30"
          >
            Next
          </button>
        ) : (
          <>
            <button
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Announce Now"}
            </button>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="w-full py-4 rounded-pill bg-bg-elevated text-ink-primary font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              Save as Draft
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-caption text-ink-muted flex-shrink-0">{label}</span>
      <span className="text-caption text-ink-primary text-right">{value}</span>
    </div>
  );
}
