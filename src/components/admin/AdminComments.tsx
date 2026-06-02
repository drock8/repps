import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";

interface CommentItem {
  id: string;
  description: string;
  user_name: string;
  user_id: string | null;
  is_testimonial: boolean;
  created_at: string;
  vote_count: number;
  admin_reply: string | null;
  replied_at: string | null;
}

export default function AdminComments() {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "testimonials">("all");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyingSaving, setReplyingSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_feedback_with_votes", { p_type: "comment" });
    if (data) setItems(data as CommentItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleTestimonial(item: CommentItem) {
    const newVal = !item.is_testimonial;
    await supabase.from("feedback").update({ is_testimonial: newVal, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, is_testimonial: newVal } : i));
  }

  function startReply(item: CommentItem) {
    setReplyingId(item.id);
    setReplyText(item.admin_reply ?? "");
  }

  async function saveReply(itemId: string) {
    setReplyingSaving(true);
    const reply = replyText.trim() || null;
    await supabase.from("feedback").update({
      admin_reply: reply,
      replied_at: reply ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, admin_reply: reply, replied_at: reply ? new Date().toISOString() : null } : i));
    setReplyingSaving(false);
    setReplyingId(null);
  }

  async function deleteComment(id: string) {
    if (!confirm("Delete this comment?")) return;
    await supabase.from("feedback").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const filtered = filter === "testimonials" ? items.filter((i) => i.is_testimonial) : items;
  const testimonialCount = items.filter((i) => i.is_testimonial).length;

  if (loading) {
    return <div className="text-ink-muted text-sm py-8 text-center">Loading comments...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header with filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              filter === "all" ? "repps-gradient text-white" : "bg-bg-surface text-ink-muted border border-divider"
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setFilter("testimonials")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              filter === "testimonials" ? "repps-gradient text-white" : "bg-bg-surface text-ink-muted border border-divider"
            }`}
          >
            Testimonials ({testimonialCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="bg-bg-surface rounded-2xl border border-divider p-8 text-center">
          <p className="text-ink-muted text-sm">
            {filter === "testimonials" ? "No testimonials flagged yet." : "No comments yet. Users can submit comments via the feedback button."}
          </p>
        </div>
      )}

      {/* Comments list */}
      <div className="space-y-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`bg-bg-surface rounded-2xl border p-4 transition-colors ${
              item.is_testimonial ? "border-accent/30 bg-accent/5" : "border-divider"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-primary leading-relaxed whitespace-pre-line">
                  "{item.description}"
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-ink-muted font-medium">— {item.user_name}</span>
                  <span className="text-[10px] text-ink-muted">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  {item.is_testimonial && (
                    <span className="text-[10px] font-bold text-accent px-1.5 py-0.5 rounded bg-accent/10">
                      Testimonial
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => startReply(item)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    item.admin_reply
                      ? "text-blue-400 bg-blue-400/10 hover:bg-blue-400/20"
                      : "text-ink-muted hover:text-blue-400 hover:bg-blue-400/10"
                  }`}
                  title={item.admin_reply ? "Edit reply" : "Reply"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => toggleTestimonial(item)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    item.is_testimonial
                      ? "text-accent bg-accent/10 hover:bg-accent/20"
                      : "text-ink-muted hover:text-accent hover:bg-accent/10"
                  }`}
                  title={item.is_testimonial ? "Remove testimonial flag" : "Flag as testimonial"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={item.is_testimonial ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                </button>
                <button
                  onClick={() => deleteComment(item.id)}
                  className="p-1.5 rounded-lg text-ink-muted hover:text-error hover:bg-error/10 transition-colors"
                  title="Delete comment"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Existing reply display */}
            {item.admin_reply && replyingId !== item.id && (
              <div className="mt-3 bg-accent/5 rounded-lg p-3 border border-accent/20">
                <p className="text-[10px] font-bold text-accent mb-1">Your Reply</p>
                <p className="text-xs text-ink-primary leading-relaxed whitespace-pre-line">{item.admin_reply}</p>
              </div>
            )}

            {/* Reply editor */}
            {replyingId === item.id && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  rows={2}
                  maxLength={2000}
                  autoFocus
                  className="w-full bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveReply(item.id)}
                    disabled={replyingSaving}
                    className="repps-gradient text-black text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-50"
                  >
                    {replyingSaving ? "Saving..." : item.admin_reply ? "Update" : "Send Reply"}
                  </button>
                  <button
                    onClick={() => setReplyingId(null)}
                    className="text-xs text-ink-muted hover:text-ink-secondary"
                  >
                    Cancel
                  </button>
                  {item.admin_reply && (
                    <button
                      onClick={() => { setReplyText(""); saveReply(item.id); }}
                      className="text-xs text-ink-muted hover:text-error transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
