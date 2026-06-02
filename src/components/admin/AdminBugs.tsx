import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";

interface BugItem {
  id: string;
  type: string;
  title: string | null;
  description: string;
  screenshot_url: string | null;
  user_id: string | null;
  user_name: string;
  source: string;
  status: string;
  priority_order: number | null;
  is_testimonial: boolean;
  created_at: string;
  updated_at: string;
  admin_reply: string | null;
  replied_at: string | null;
  user_replies: { text: string; created_at: string; from: "user" | "admin" }[];
  vote_count: number;
  user_voted: boolean;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "investigating", label: "Investigating" },
  { value: "building", label: "Fixing" },
  { value: "fixed", label: "Fixed" },
  { value: "wont_fix", label: "Won't Fix" },
];

export default function AdminBugs() {
  const [items, setItems] = useState<BugItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BugItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyingSaving, setReplyingSaving] = useState(false);
  const dragItemRef = useRef<BugItem | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_feedback_with_votes", { p_type: "bug" });
    if (data) setItems(data as BugItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const prioritized = items
    .filter((i) => i.priority_order !== null)
    .sort((a, b) => (a.priority_order ?? 0) - (b.priority_order ?? 0));
  const myBugs = items.filter((i) => i.source === "admin" && i.priority_order === null);
  const userBugs = items.filter((i) => i.source === "user" && i.priority_order === null);

  async function addToPriority(item: BugItem) {
    const maxOrder = prioritized.length > 0 ? Math.max(...prioritized.map((p) => p.priority_order ?? 0)) : 0;
    const newOrder = maxOrder + 1;
    await supabase.from("feedback").update({ priority_order: newOrder, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, priority_order: newOrder } : i));
  }

  async function removeFromPriority(item: BugItem) {
    await supabase.from("feedback").update({ priority_order: null, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, priority_order: null } : i));
  }

  async function reorderPriority(dragId: string, dropId: string) {
    if (dragId === dropId) return;
    const ordered = [...prioritized];
    const dragIdx = ordered.findIndex((i) => i.id === dragId);
    const dropIdx = ordered.findIndex((i) => i.id === dropId);
    if (dragIdx === -1 || dropIdx === -1) return;
    const [moved] = ordered.splice(dragIdx, 1);
    ordered.splice(dropIdx, 0, moved);
    const updates = ordered.map((item, idx) => ({ id: item.id, priority_order: idx + 1 }));
    await supabase.rpc("update_feedback_priority", { p_items: updates });
    setItems((prev) => {
      const map = new Map(updates.map((u) => [u.id, u.priority_order]));
      return prev.map((i) => map.has(i.id) ? { ...i, priority_order: map.get(i.id)! } : i);
    });
  }

  async function updateStatus(itemId: string, status: string) {
    await supabase.from("feedback").update({ status, updated_at: new Date().toISOString() }).eq("id", itemId);
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status } : i));
    if (selected?.id === itemId) setSelected((prev) => prev ? { ...prev, status } : null);
    setEditingStatus(null);
  }

  function selectItem(item: BugItem | null) {
    setSelected(item);
    setReplyText(item?.admin_reply ?? "");
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
    if (selected?.id === itemId) setSelected((prev) => prev ? { ...prev, admin_reply: reply, replied_at: reply ? new Date().toISOString() : null } : null);
    setReplyingSaving(false);
  }

  async function addAdminBug() {
    const title = prompt("Bug summary:");
    if (!title?.trim()) return;
    const description = prompt("Steps to reproduce / details:") ?? "";
    const { data, error } = await supabase.from("feedback").insert({
      type: "bug",
      title: title.trim(),
      description: description.trim() || title.trim(),
      source: "admin",
      user_name: "Admin",
      user_id: (await supabase.auth.getUser()).data.user?.id,
    }).select().single();
    if (!error && data) {
      setItems((prev) => [{ ...data, vote_count: 0, user_voted: false } as BugItem, ...prev]);
    }
  }

  function handleDragStart(item: BugItem) {
    dragItemRef.current = item;
    setDragging(item.id);
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOver(targetId);
  }

  function handleDropOnPriority(e: React.DragEvent, targetId?: string) {
    e.preventDefault();
    const item = dragItemRef.current;
    if (!item) return;
    if (item.priority_order === null) {
      addToPriority(item);
    } else if (targetId) {
      reorderPriority(item.id, targetId);
    }
    setDragging(null);
    setDragOver(null);
    dragItemRef.current = null;
  }

  function handleDragEnd() {
    setDragging(null);
    setDragOver(null);
    dragItemRef.current = null;
  }

  if (loading) {
    return <div className="text-ink-muted text-sm py-8 text-center">Loading bugs...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Prioritized */}
        <div
          className="bg-bg-surface rounded-2xl border border-divider p-4 min-h-[300px]"
          onDragOver={(e) => { e.preventDefault(); setDragOver("priority-zone"); }}
          onDrop={(e) => handleDropOnPriority(e)}
          onDragLeave={() => setDragOver(null)}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink-primary">
              Prioritized
              <span className="text-ink-muted font-normal ml-1">({prioritized.length})</span>
            </h3>
            <span className="text-[10px] text-ink-muted uppercase tracking-wider">Fix Queue</span>
          </div>
          {prioritized.length === 0 && (
            <div className={`border-2 border-dashed rounded-xl p-6 text-center text-xs text-ink-muted transition-colors ${dragOver === "priority-zone" ? "border-error bg-error/5" : "border-divider"}`}>
              Drag bugs here to prioritize
            </div>
          )}
          <div className="space-y-2">
            {prioritized.map((item, idx) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(item)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDrop={(e) => handleDropOnPriority(e, item.id)}
                onDragEnd={handleDragEnd}
                onClick={() => selectItem(item)}
                className={`group flex items-start gap-2 p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                  dragging === item.id ? "opacity-40" : ""
                } ${dragOver === item.id ? "border-error bg-error/5" : "border-divider bg-bg-elevated hover:border-ink-muted/30"
                } ${selected?.id === item.id ? "ring-1 ring-error" : ""}`}
              >
                <span className="text-xs font-bold text-error mt-0.5 w-5 text-center flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-primary truncate">{item.title || item.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <BugStatusBadge status={item.status} />
                    {item.source === "user" && (
                      <span className="text-[10px] text-ink-muted">{item.user_name}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromPriority(item); }}
                  className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-error text-xs transition-opacity flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center: My Bugs */}
        <div className="bg-bg-surface rounded-2xl border border-divider p-4 min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink-primary">
              My Bugs
              <span className="text-ink-muted font-normal ml-1">({myBugs.length})</span>
            </h3>
            <button onClick={addAdminBug} className="text-error text-xs font-semibold hover:opacity-80">
              + Report
            </button>
          </div>
          {myBugs.length === 0 && (
            <p className="text-xs text-ink-muted text-center py-6">No bugs logged. Tap + Report to add.</p>
          )}
          <div className="space-y-2">
            {myBugs.map((item) => (
              <BugCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                dragging={dragging === item.id}
                onDragStart={() => handleDragStart(item)}
                onDragEnd={handleDragEnd}
                onClick={() => selectItem(item)}
                onAddToPriority={() => addToPriority(item)}
              />
            ))}
          </div>
        </div>

        {/* Right: User Reports */}
        <div className="bg-bg-surface rounded-2xl border border-divider p-4 min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink-primary">
              User Reports
              <span className="text-ink-muted font-normal ml-1">({userBugs.length})</span>
            </h3>
            <span className="text-[10px] text-ink-muted uppercase tracking-wider">From Users</span>
          </div>
          {userBugs.length === 0 && (
            <p className="text-xs text-ink-muted text-center py-6">No user bug reports yet.</p>
          )}
          <div className="space-y-2">
            {userBugs.map((item) => (
              <BugCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                dragging={dragging === item.id}
                onDragStart={() => handleDragStart(item)}
                onDragEnd={handleDragEnd}
                onClick={() => selectItem(item)}
                onAddToPriority={() => addToPriority(item)}
                showScreenshot
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="bg-bg-surface rounded-2xl border border-divider p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-ink-primary">{selected.title || "Untitled Bug"}</h3>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs text-ink-muted">
                  by {selected.user_name} · {new Date(selected.created_at).toLocaleDateString()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${selected.source === "admin" ? "bg-error/10 text-error" : "bg-blue-500/10 text-blue-400"}`}>
                  {selected.source === "admin" ? "My Bug" : "User Report"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {editingStatus === selected.id ? (
                <div className="flex flex-wrap gap-1">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => updateStatus(selected.id, s.value)}
                      className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                        selected.status === s.value
                          ? "border-error bg-error/10 text-error"
                          : "border-divider text-ink-muted hover:border-ink-muted/40"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEditingStatus(selected.id)} className="flex items-center gap-1">
                  <BugStatusBadge status={selected.status} />
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-muted">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              <button onClick={() => selectItem(null)} className="text-ink-muted hover:text-ink-primary text-sm ml-2">✕</button>
            </div>
          </div>
          <p className="text-sm text-ink-secondary mt-4 leading-relaxed whitespace-pre-line">{selected.description}</p>
          {selected.screenshot_url && (
            <div className="mt-4">
              <img src={selected.screenshot_url} alt="Bug screenshot" className="rounded-xl max-h-80 border border-divider" />
            </div>
          )}
          {/* Conversation thread */}
          {selected.source === "user" && selected.user_replies && selected.user_replies.length > 0 && (
            <div className="mt-4 border-t border-divider pt-4 space-y-2">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Conversation</label>
              {selected.user_replies.map((r, idx) => (
                <div key={idx} className={`rounded-lg p-3 ${r.from === "admin" ? "bg-accent/10 border border-accent/20" : "bg-bg-elevated border border-divider"}`}>
                  <p className={`text-[10px] font-semibold mb-1 ${r.from === "admin" ? "text-accent" : "text-ink-muted"}`}>
                    {r.from === "admin" ? "You" : selected.user_name} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-ink-primary leading-relaxed whitespace-pre-line">{r.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Reply section */}
          {selected.source === "user" && (
            <div className="mt-4 border-t border-divider pt-4">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Reply to User</label>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply the user will see in their feedback history..."
                rows={2}
                maxLength={2000}
                className="w-full mt-2 bg-bg-input border border-divider rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted/50 focus:outline-none focus:border-accent resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => saveReply(selected.id)}
                  disabled={replyingSaving}
                  className="repps-gradient text-black text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-50"
                >
                  {replyingSaving ? "Saving..." : selected.admin_reply ? "Update Reply" : "Send Reply"}
                </button>
                {selected.admin_reply && (
                  <button
                    onClick={() => { setReplyText(""); saveReply(selected.id); }}
                    className="text-xs text-ink-muted hover:text-error transition-colors"
                  >
                    Remove Reply
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {selected.priority_order === null ? (
              <button
                onClick={() => { addToPriority(selected); selectItem({ ...selected, priority_order: 999 }); }}
                className="bg-error text-white text-xs font-semibold px-4 py-2 rounded-xl"
              >
                Add to Fix Queue
              </button>
            ) : (
              <button
                onClick={() => { removeFromPriority(selected); selectItem({ ...selected, priority_order: null }); }}
                className="bg-bg-elevated text-ink-secondary text-xs font-semibold px-4 py-2 rounded-xl border border-divider"
              >
                Remove from Queue
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BugCard({
  item, selected, dragging, onDragStart, onDragEnd, onClick, onAddToPriority, showScreenshot,
}: {
  item: BugItem; selected: boolean; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
  onAddToPriority: () => void; showScreenshot?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
        dragging ? "opacity-40" : ""
      } ${selected ? "border-error ring-1 ring-error" : "border-divider hover:border-ink-muted/30"} bg-bg-elevated`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-primary truncate">{item.title || item.description}</p>
          <div className="flex items-center justify-between mt-1.5">
            <div className="flex items-center gap-2">
              <BugStatusBadge status={item.status} />
              <span className="text-[10px] text-ink-muted">{item.user_name}</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onAddToPriority(); }}
              className="opacity-0 group-hover:opacity-100 text-error text-[10px] font-semibold transition-opacity"
            >
              + Queue
            </button>
          </div>
        </div>
        {showScreenshot && item.screenshot_url && (
          <img src={item.screenshot_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-divider" />
        )}
      </div>
    </div>
  );
}

function BugStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    new: { label: "New", className: "bg-error/10 text-error" },
    investigating: { label: "Investigating", className: "bg-yellow-400/10 text-yellow-400" },
    building: { label: "Fixing", className: "bg-accent/10 text-accent" },
    fixed: { label: "Fixed", className: "bg-success/10 text-success" },
    wont_fix: { label: "Won't Fix", className: "bg-ink-muted/10 text-ink-muted" },
  };
  const c = config[status] ?? config.new;
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.className}`}>{c.label}</span>;
}
