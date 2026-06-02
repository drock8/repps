import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type FeedbackType = "feature" | "bug" | "comment";
type FABView = "submit" | "history";

interface UserReply {
  text: string;
  created_at: string;
  from: "user" | "admin";
}

interface FeedbackItem {
  id: string;
  type: string;
  title: string | null;
  description: string;
  status: string;
  admin_reply: string | null;
  replied_at: string | null;
  user_replies: UserReply[];
  created_at: string;
}

const TYPE_CONFIG: { id: FeedbackType; label: string; placeholder: string; hasTitle: boolean }[] = [
  { id: "comment", label: "Comment", placeholder: "Share your thoughts, feedback, or experience...", hasTitle: false },
  { id: "feature", label: "Feature", placeholder: "Describe the feature you'd like to see...", hasTitle: true },
  { id: "bug", label: "Bug", placeholder: "What went wrong? Steps to reproduce...", hasTitle: true },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Submitted", color: "text-ink-muted" },
  considering: { label: "Considering", color: "text-blue-500" },
  planned: { label: "Planned", color: "text-purple-500" },
  building: { label: "Building", color: "text-accent" },
  done: { label: "Done", color: "text-green-500" },
  dismissed: { label: "Dismissed", color: "text-ink-muted" },
  investigating: { label: "Investigating", color: "text-blue-500" },
  fixed: { label: "Fixed", color: "text-green-500" },
  wont_fix: { label: "Won't Fix", color: "text-ink-muted" },
};

export default function FeedbackFAB() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<FABView>("submit");
  const [activeType, setActiveType] = useState<FeedbackType>("comment");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threadReply, setThreadReply] = useState("");
  const [threadSending, setThreadSending] = useState(false);
  const [seenReplies, setSeenReplies] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("repps_seen_replies");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const config = TYPE_CONFIG.find((t) => t.id === activeType)!;

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    const { data } = await supabase
      .from("feedback")
      .select("id, type, title, description, status, admin_reply, replied_at, user_replies, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setHistory(data);
    setHistoryLoading(false);
  }, [user]);

  useEffect(() => {
    if (open && view === "history") loadHistory();
  }, [open, view, loadHistory]);

  function markSeen(itemId: string) {
    setSeenReplies((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      localStorage.setItem("repps_seen_replies", JSON.stringify([...next]));
      return next;
    });
  }

  async function sendThreadReply(itemId: string) {
    if (!threadReply.trim()) return;
    setThreadSending(true);
    const item = history.find((h) => h.id === itemId);
    if (!item) { setThreadSending(false); return; }
    const newReply: UserReply = { text: threadReply.trim(), created_at: new Date().toISOString(), from: "user" };
    const updated = [...(item.user_replies ?? []), newReply];
    await supabase.from("feedback").update({
      user_replies: updated,
      updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    setHistory((prev) => prev.map((h) => h.id === itemId ? { ...h, user_replies: updated } : h));
    setThreadReply("");
    setThreadSending(false);
  }

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
    setTimeout(() => {
      reset();
      setView("submit");
      setExpandedId(null);
    }, 300);
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

  function formatDate(d: string) {
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  const typeIcon = (type: string) => {
    if (type === "feature") return "✨";
    if (type === "bug") return "🐛";
    return "💬";
  };

  const hasUnread = history.some((h) => h.admin_reply && !seenReplies.has(h.id));

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        style={{ background: "var(--color-accent)", boxShadow: "0 4px 16px rgba(var(--color-accent-glow), 0.4)" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          <line x1="12" y1="8" x2="12" y2="14" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </svg>
        {hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-bg-base" />
        )}
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-bg-elevated rounded-t-2xl border-t border-divider overflow-hidden"
            style={{ animation: "slideUp 0.3s ease-out", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-ink-muted/30" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink-primary">
                {view === "submit" ? "Send Feedback" : "My Feedback"}
              </h2>
              <button onClick={handleClose} className="text-ink-muted text-sm font-medium">
                Cancel
              </button>
            </div>

            {/* View Toggle */}
            {user && (
              <div className="px-5 flex gap-2 pb-3">
                <button
                  onClick={() => setView("submit")}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    view === "submit"
                      ? "bg-ink-primary text-ink-inverse"
                      : "bg-bg-surface text-ink-secondary border border-divider"
                  }`}
                >
                  New Feedback
                </button>
                <button
                  onClick={() => setView("history")}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all relative ${
                    view === "history"
                      ? "bg-ink-primary text-ink-inverse"
                      : "bg-bg-surface text-ink-secondary border border-divider"
                  }`}
                >
                  My Feedback
                  {history.some((h) => h.admin_reply && !seenReplies.has(h.id)) && view !== "history" && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                  )}
                </button>
              </div>
            )}

            {view === "submit" ? (
              <>
                {/* Type Tabs */}
                <div className="px-5 flex gap-2 pb-4">
                  {TYPE_CONFIG.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setActiveType(t.id); setError(""); }}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                        activeType === t.id
                          ? "repps-gradient text-black"
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

                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={config.placeholder}
                      rows={3}
                      maxLength={2000}
                      className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent resize-none"
                    />

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
                      className="w-full repps-gradient text-black font-semibold py-3 rounded-xl text-sm disabled:opacity-50 transition-opacity"
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
              </>
            ) : (
              /* My Feedback History */
              <div className="px-5 pb-6 overflow-y-auto" style={{ maxHeight: "60vh" }}>
                {historyLoading ? (
                  <div className="text-ink-muted text-sm py-8 text-center">Loading...</div>
                ) : history.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-ink-muted text-sm">No feedback submitted yet.</p>
                    <button
                      onClick={() => setView("submit")}
                      className="text-accent text-sm font-medium mt-2"
                    >
                      Send your first feedback
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((item) => {
                      const isExpanded = expandedId === item.id;
                      const statusInfo = STATUS_LABELS[item.status] ?? { label: item.status, color: "text-ink-muted" };
                      const hasReply = item.admin_reply || (item.user_replies && item.user_replies.length > 0);
                      const replyCount = (item.admin_reply ? 1 : 0) + (item.user_replies?.length ?? 0);
                      return (
                        <div
                          key={item.id}
                          className={`w-full text-left rounded-xl border transition-all ${
                            hasReply
                              ? "border-accent/30 bg-accent/5"
                              : "border-divider bg-bg-surface"
                          }`}
                        >
                          {/* Collapsed header — always tappable */}
                          <button
                            onClick={() => { setExpandedId(isExpanded ? null : item.id); setThreadReply(""); if (!isExpanded && item.admin_reply) markSeen(item.id); }}
                            className="w-full text-left p-3"
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-base flex-shrink-0">{typeIcon(item.type)}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-ink-primary truncate">
                                    {item.title ?? item.description.slice(0, 50)}
                                  </p>
                                  <span className="text-[10px] text-ink-muted flex-shrink-0">
                                    {formatDate(item.created_at)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-[10px] font-semibold ${statusInfo.color}`}>
                                    {statusInfo.label}
                                  </span>
                                  {replyCount > 0 && (
                                    <span className="text-[10px] font-bold text-accent px-1.5 py-0.5 rounded bg-accent/10">
                                      {replyCount} {replyCount === 1 ? "reply" : "replies"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>

                          {/* Expanded thread */}
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2">
                              {/* Original message */}
                              <div className="bg-bg-elevated rounded-lg p-3 ml-6">
                                <p className="text-[10px] font-semibold text-ink-muted mb-1">You · {formatDate(item.created_at)}</p>
                                <p className="text-xs text-ink-primary leading-relaxed whitespace-pre-line">
                                  {item.description}
                                </p>
                              </div>

                              {/* Build conversation timeline from admin_reply + user_replies */}
                              {(() => {
                                const messages: { text: string; from: "user" | "admin"; created_at: string }[] = [];
                                if (item.admin_reply && item.replied_at) {
                                  messages.push({ text: item.admin_reply, from: "admin", created_at: item.replied_at });
                                }
                                if (item.user_replies) {
                                  messages.push(...item.user_replies);
                                }
                                messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                                return messages.map((msg, idx) => (
                                  <div
                                    key={idx}
                                    className={`rounded-lg p-3 ${
                                      msg.from === "admin"
                                        ? "bg-accent/10 border border-accent/20 ml-6"
                                        : "bg-bg-elevated ml-6"
                                    }`}
                                  >
                                    <p className={`text-[10px] font-semibold mb-1 ${msg.from === "admin" ? "text-accent" : "text-ink-muted"}`}>
                                      {msg.from === "admin" ? "REPPs Team" : "You"} · {formatDate(msg.created_at)}
                                    </p>
                                    <p className="text-xs text-ink-primary leading-relaxed whitespace-pre-line">
                                      {msg.text}
                                    </p>
                                  </div>
                                ));
                              })()}

                              {/* Reply input */}
                              <div className="flex gap-2 ml-6 pt-1">
                                <input
                                  type="text"
                                  value={threadReply}
                                  onChange={(e) => setThreadReply(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendThreadReply(item.id); } }}
                                  placeholder="Write a reply..."
                                  maxLength={2000}
                                  className="flex-1 bg-bg-input border border-divider rounded-xl px-3 py-2 text-xs text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent"
                                />
                                <button
                                  onClick={() => sendThreadReply(item.id)}
                                  disabled={threadSending || !threadReply.trim()}
                                  className="repps-gradient text-black text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-30"
                                >
                                  {threadSending ? "..." : "Send"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
