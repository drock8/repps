import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";

interface FeedbackItem {
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
  vote_count: number;
  user_voted: boolean;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "text-ink-muted" },
  { value: "considering", label: "Considering", color: "text-yellow-400" },
  { value: "planned", label: "Planned", color: "text-blue-400" },
  { value: "building", label: "Building", color: "text-accent" },
  { value: "done", label: "Done", color: "text-success" },
  { value: "dismissed", label: "Dismissed", color: "text-ink-muted" },
];

export default function AdminFeatures() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const dragItemRef = useRef<FeedbackItem | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_feedback_with_votes", { p_type: "feature" });
    if (data) setItems(data as FeedbackItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const prioritized = items
    .filter((i) => i.priority_order !== null)
    .sort((a, b) => (a.priority_order ?? 0) - (b.priority_order ?? 0));
  const myIdeas = items.filter((i) => i.source === "admin" && i.priority_order === null);
  const userIdeas = items.filter((i) => i.source === "user" && i.priority_order === null);

  async function addToPriority(item: FeedbackItem) {
    const maxOrder = prioritized.length > 0 ? Math.max(...prioritized.map((p) => p.priority_order ?? 0)) : 0;
    const newOrder = maxOrder + 1;
    await supabase.from("feedback").update({ priority_order: newOrder, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, priority_order: newOrder } : i));
  }

  async function removeFromPriority(item: FeedbackItem) {
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

  async function addAdminIdea() {
    const title = prompt("Feature name:");
    if (!title?.trim()) return;
    const description = prompt("Brief description:") ?? "";
    const { data, error } = await supabase.from("feedback").insert({
      type: "feature",
      title: title.trim(),
      description: description.trim() || title.trim(),
      source: "admin",
      user_name: "Admin",
      user_id: (await supabase.auth.getUser()).data.user?.id,
    }).select().single();
    if (!error && data) {
      setItems((prev) => [{ ...data, vote_count: 0, user_voted: false } as FeedbackItem, ...prev]);
    }
  }

  function handleDragStart(item: FeedbackItem) {
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
    return <div className="text-ink-muted text-sm py-8 text-center">Loading features...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 3-column board */}
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
            <span className="text-[10px] text-ink-muted uppercase tracking-wider">Build Queue</span>
          </div>
          {prioritized.length === 0 && (
            <div className={`border-2 border-dashed rounded-xl p-6 text-center text-xs text-ink-muted transition-colors ${dragOver === "priority-zone" ? "border-accent bg-accent/5" : "border-divider"}`}>
              Drag features here to prioritize
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
                onClick={() => setSelected(item)}
                className={`group flex items-start gap-2 p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                  dragging === item.id ? "opacity-40" : ""
                } ${dragOver === item.id ? "border-accent bg-accent/5" : "border-divider bg-bg-elevated hover:border-ink-muted/30"
                } ${selected?.id === item.id ? "ring-1 ring-accent" : ""}`}
              >
                <span className="text-xs font-bold text-accent mt-0.5 w-5 text-center flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-primary truncate">{item.title || item.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={item.status} />
                    {item.source === "user" && (
                      <span className="text-[10px] text-ink-muted">
                        {item.vote_count} vote{item.vote_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromPriority(item); }}
                  className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-error text-xs transition-opacity flex-shrink-0"
                  title="Remove from priority"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center: My Ideas */}
        <div className="bg-bg-surface rounded-2xl border border-divider p-4 min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink-primary">
              My Ideas
              <span className="text-ink-muted font-normal ml-1">({myIdeas.length})</span>
            </h3>
            <button
              onClick={addAdminIdea}
              className="text-accent text-xs font-semibold hover:opacity-80"
            >
              + Add
            </button>
          </div>
          {myIdeas.length === 0 && (
            <p className="text-xs text-ink-muted text-center py-6">No ideas yet. Tap + Add to start.</p>
          )}
          <div className="space-y-2">
            {myIdeas.map((item) => (
              <FeatureCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                dragging={dragging === item.id}
                onDragStart={() => handleDragStart(item)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelected(item)}
                onAddToPriority={() => addToPriority(item)}
              />
            ))}
          </div>
        </div>

        {/* Right: User Requests */}
        <div className="bg-bg-surface rounded-2xl border border-divider p-4 min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink-primary">
              User Requests
              <span className="text-ink-muted font-normal ml-1">({userIdeas.length})</span>
            </h3>
            <span className="text-[10px] text-ink-muted uppercase tracking-wider">From Users</span>
          </div>
          {userIdeas.length === 0 && (
            <p className="text-xs text-ink-muted text-center py-6">No user requests yet.</p>
          )}
          <div className="space-y-2">
            {userIdeas.map((item) => (
              <FeatureCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                dragging={dragging === item.id}
                onDragStart={() => handleDragStart(item)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelected(item)}
                onAddToPriority={() => addToPriority(item)}
                showVotes
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
              <h3 className="text-lg font-bold text-ink-primary">{selected.title || "Untitled"}</h3>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs text-ink-muted">
                  by {selected.user_name} · {new Date(selected.created_at).toLocaleDateString()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${selected.source === "admin" ? "bg-accent/10 text-accent" : "bg-blue-500/10 text-blue-400"}`}>
                  {selected.source === "admin" ? "My Idea" : "User Request"}
                </span>
                {selected.vote_count > 0 && (
                  <span className="text-xs text-ink-muted">
                    {selected.vote_count} vote{selected.vote_count !== 1 ? "s" : ""}
                  </span>
                )}
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
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-divider text-ink-muted hover:border-ink-muted/40"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  onClick={() => setEditingStatus(selected.id)}
                  className="flex items-center gap-1"
                >
                  <StatusBadge status={selected.status} />
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-muted">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              <button onClick={() => setSelected(null)} className="text-ink-muted hover:text-ink-primary text-sm ml-2">
                ✕
              </button>
            </div>
          </div>
          <p className="text-sm text-ink-secondary mt-4 leading-relaxed whitespace-pre-line">
            {selected.description}
          </p>
          {selected.screenshot_url && (
            <div className="mt-4">
              <img
                src={selected.screenshot_url}
                alt="Screenshot"
                className="rounded-xl max-h-64 border border-divider"
              />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {selected.priority_order === null ? (
              <button
                onClick={() => { addToPriority(selected); setSelected({ ...selected, priority_order: 999 }); }}
                className="repps-gradient text-white text-xs font-semibold px-4 py-2 rounded-xl"
              >
                Add to Priority Queue
              </button>
            ) : (
              <button
                onClick={() => { removeFromPriority(selected); setSelected({ ...selected, priority_order: null }); }}
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

function FeatureCard({
  item, selected, dragging, onDragStart, onDragEnd, onClick, onAddToPriority, showVotes,
}: {
  item: FeedbackItem; selected: boolean; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
  onAddToPriority: () => void; showVotes?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
        dragging ? "opacity-40" : ""
      } ${selected ? "border-accent ring-1 ring-accent" : "border-divider hover:border-ink-muted/30"} bg-bg-elevated`}
    >
      <p className="text-sm font-medium text-ink-primary truncate">{item.title || item.description}</p>
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          {showVotes && (
            <span className="text-[10px] text-ink-muted flex items-center gap-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" transform="rotate(-90 12 12)" /></svg>
              {item.vote_count}
            </span>
          )}
          <span className="text-[10px] text-ink-muted">{item.user_name}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onAddToPriority(); }}
          className="opacity-0 group-hover:opacity-100 text-accent text-[10px] font-semibold transition-opacity"
          title="Add to priority queue"
        >
          + Queue
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    new: { label: "New", className: "bg-ink-muted/10 text-ink-muted" },
    considering: { label: "Considering", className: "bg-yellow-400/10 text-yellow-400" },
    planned: { label: "Planned", className: "bg-blue-400/10 text-blue-400" },
    building: { label: "Building", className: "bg-accent/10 text-accent" },
    done: { label: "Done", className: "bg-success/10 text-success" },
    dismissed: { label: "Dismissed", className: "bg-ink-muted/10 text-ink-muted" },
  };
  const c = config[status] ?? config.new;
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.className}`}>{c.label}</span>;
}
