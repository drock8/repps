import { useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type FeedbackType = "feature" | "bug" | "comment";

const TYPE_CONFIG: { id: FeedbackType; label: string; icon: string; placeholder: string; hasTitle: boolean }[] = [
  { id: "feature", label: "Feature", icon: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z", placeholder: "Describe the feature you'd like to see...", hasTitle: true },
  { id: "bug", label: "Bug", icon: "M14 12h-4v-2h4m0 6h-4v-2h4m2-8V4h-2l-1 2h-2L10 4H8v2a4 4 0 00-4 4v1a2 2 0 00-2 2v1a2 2 0 002 2v1a4 4 0 004 4h4a4 4 0 004-4v-1a2 2 0 002-2v-1a2 2 0 00-2-2v-1a4 4 0 00-4-4z", placeholder: "What went wrong? Steps to reproduce...", hasTitle: true },
  { id: "comment", label: "Comment", icon: "M20 2H4a2 2 0 00-2 2v12a2 2 0 002 2h14l4 4V4a2 2 0 00-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z", placeholder: "Share your thoughts, feedback, or experience...", hasTitle: false },
];

export default function FeedbackFAB() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<FeedbackType>("feature");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const config = TYPE_CONFIG.find((t) => t.id === activeType)!;

  function reset() {
    setTitle("");
    setDescription("");
    setFile(null);
    setError("");
    setSuccess(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    setOpen(false);
    setTimeout(reset, 300);
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError("Please add a description.");
      return;
    }
    if (config.hasTitle && !title.trim()) {
      setError("Please add a title.");
      return;
    }

    setSubmitting(true);
    setError("");

    let screenshotUrl: string | null = null;

    if (file) {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user?.id ?? "anon"}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("feedback-screenshots")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) {
        setError("Screenshot upload failed. Try without it.");
        setSubmitting(false);
        return;
      }
      const { data: urlData } = supabase.storage
        .from("feedback-screenshots")
        .getPublicUrl(path);
      screenshotUrl = urlData.publicUrl;
    }

    const { error: insertErr } = await supabase.from("feedback").insert({
      type: activeType,
      title: config.hasTitle ? title.trim() : null,
      description: description.trim(),
      screenshot_url: screenshotUrl,
      user_id: user?.id ?? null,
      user_name: profile?.name ?? user?.email ?? "Anonymous",
      source: "user",
    });

    if (insertErr) {
      setError("Failed to submit. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSuccess(true);
    setTimeout(handleClose, 1500);
  }

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full repps-gradient flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        style={{ boxShadow: "0 4px 16px rgba(var(--color-accent-glow), 0.4)" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          <line x1="12" y1="8" x2="12" y2="14" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </svg>
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-bg-elevated rounded-t-2xl border-t border-divider overflow-hidden"
            style={{ animation: "slideUp 0.3s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-ink-muted/30" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink-primary">Send Feedback</h2>
              <button onClick={handleClose} className="text-ink-muted text-sm font-medium">
                Cancel
              </button>
            </div>

            {/* Type Tabs */}
            <div className="px-5 flex gap-2 pb-4">
              {TYPE_CONFIG.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveType(t.id); setError(""); }}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeType === t.id
                      ? "repps-gradient text-white"
                      : "bg-bg-surface text-ink-secondary border border-divider"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {success ? (
              <div className="px-5 pb-8 text-center">
                <div className="text-3xl mb-2">
                  {activeType === "bug" ? "🐛" : activeType === "feature" ? "✨" : "💬"}
                </div>
                <p className="text-ink-primary font-semibold">Thanks for your feedback!</p>
                <p className="text-ink-muted text-xs mt-1">We'll review it soon.</p>
              </div>
            ) : (
              <div className="px-5 pb-6 space-y-3">
                {/* Title (features + bugs only) */}
                {config.hasTitle && (
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={activeType === "bug" ? "Bug summary" : "Feature name"}
                    maxLength={100}
                    className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent"
                  />
                )}

                {/* Description */}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={config.placeholder}
                  rows={3}
                  maxLength={2000}
                  className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent resize-none"
                />

                {/* Screenshot (features + bugs) */}
                {config.hasTitle && (
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-2 text-xs text-ink-muted hover:text-ink-secondary transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      {file ? file.name : "Attach screenshot (optional)"}
                    </button>
                  </div>
                )}

                {error && <p className="text-error text-xs">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full repps-gradient text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50 transition-opacity"
                >
                  {submitting ? "Sending..." : "Submit"}
                </button>

                {!user && (
                  <p className="text-ink-muted text-[10px] text-center">
                    Sign in for your feedback to be linked to your account.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
