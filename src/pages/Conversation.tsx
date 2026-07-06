import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { PRESET_MESSAGES, PRESET_KEYS } from "../lib/presets";
import { useAuth } from "../contexts/AuthContext";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  message_key: string | null;
  body: string | null;
  created_at: string;
  sender_name: string;
  sender_avatar_url: string | null;
}

interface ConvoMeta {
  type: string;
  team_id: string | null;
  other_user: { user_id: string; name: string; avatar_url: string | null } | null;
  team_info: { team_name: string } | null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

export default function Conversation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<ConvoMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nudgedToday, setNudgedToday] = useState(false);
  const [sending, setSending] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  const fetchMessages = useCallback(async (before?: string) => {
    if (!id) return;
    const params: { p_conversation_id: string; p_limit: number; p_before?: string } = {
      p_conversation_id: id,
      p_limit: 50,
    };
    if (before) params.p_before = before;

    const { data } = await supabase.rpc("get_conversation_messages", params);
    if (!Array.isArray(data)) return [];

    // Results come in desc order — reverse for chronological
    const msgs = (data as Message[]).reverse();
    setHasMore(data.length === 50);
    return msgs;
  }, [id]);

  const fetchMeta = useCallback(async () => {
    if (!id) return;
    // Get conversation metadata from inbox
    const { data: inbox } = await supabase.rpc("get_inbox");
    if (Array.isArray(inbox)) {
      const convo = inbox.find((c: { conversation_id: string }) => c.conversation_id === id);
      if (convo) {
        setMeta({
          type: convo.type,
          team_id: convo.team_id,
          other_user: convo.other_user,
          team_info: convo.team_info,
        });
      }
    }
  }, [id]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const [msgs] = await Promise.all([fetchMessages(), fetchMeta()]);
      if (msgs) setMessages(msgs);
      // Mark read
      if (id) supabase.rpc("mark_read", { p_conversation_id: id });
      setLoading(false);
      isInitialLoad.current = true;
    }
    init();
  }, [fetchMessages, fetchMeta, id]);

  // Check nudge status
  useEffect(() => {
    if (!profile || !meta?.other_user) return;
    const checkNudge = async () => {
      const { data } = await supabase.rpc("get_public_profile", { p_user_id: meta.other_user!.user_id });
      if (data?.nudged_today) setNudgedToday(true);
    };
    checkNudge();
  }, [profile, meta]);

  // Auto-scroll on initial load and new messages
  useEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
      isInitialLoad.current = false;
    }
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`convo-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
        async (payload) => {
          const newMsg = payload.new as { id: string; sender_id: string; message_type: string; message_key: string | null; body: string | null; created_at: string; conversation_id: string };
          // Fetch sender info
          const { data: senderProfile } = await supabase
            .from("public_profiles")
            .select("name, avatar_url")
            .eq("id", newMsg.sender_id)
            .single();

          const fullMsg: Message = {
            ...newMsg,
            sender_name: senderProfile?.name || "Unknown",
            sender_avatar_url: senderProfile?.avatar_url || null,
          };

          setMessages((prev) => {
            if (prev.some(m => m.id === fullMsg.id)) return prev;
            return [...prev, fullMsg];
          });

          // Mark read
          supabase.rpc("mark_read", { p_conversation_id: id });

          // Auto-scroll
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const handleLoadOlder = async () => {
    if (!messages.length || loadingMore) return;
    setLoadingMore(true);
    const oldest = messages[0];
    const older = await fetchMessages(oldest.created_at);
    if (older && older.length > 0) {
      setMessages((prev) => [...older, ...prev]);
    }
    setLoadingMore(false);
  };

  const handleSendPreset = async (key: string) => {
    if (sending) return;
    setSending(true);
    if (meta?.type === "team") {
      await supabase.rpc("send_team_message", { p_message_key: key });
    } else if (meta?.other_user) {
      await supabase.rpc("send_message", {
        p_recipient_id: meta.other_user.user_id,
        p_message_key: key,
      });
    }
    setSending(false);
  };

  const handleNudge = async () => {
    if (nudgedToday || sending || !meta?.other_user) return;
    setSending(true);
    const { data: result } = await supabase.rpc("send_nudge", {
      p_recipient_id: meta.other_user.user_id,
    });
    if (result?.success) {
      setNudgedToday(true);
    }
    setSending(false);
  };

  const handleBlock = async () => {
    if (!meta?.other_user) return;
    if (!window.confirm(`Block ${meta.other_user.name}?`)) return;
    await supabase.rpc("block_user", { p_user_id: meta.other_user.user_id });
    navigate("/inbox", { replace: true });
  };

  const headerName = meta?.type === "team" && meta.team_info
    ? meta.team_info.team_name
    : meta?.other_user?.name || "Conversation";

  const isTeam = meta?.type === "team";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 pb-3 border-b border-divider">
        <button
          onClick={() => navigate("/inbox")}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-primary">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className="text-body text-ink-primary font-semibold flex-1 truncate">{headerName}</p>
        <div className="relative">
          <button
            onClick={() => setShowOverflow(!showOverflow)}
            className="w-8 h-8 flex items-center justify-center"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-secondary">
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {showOverflow && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
              <div className="absolute right-0 top-10 z-50 bg-bg-surface rounded-lg shadow-lg py-1 min-w-[160px]">
                {meta?.other_user && (
                  <button
                    onClick={() => {
                      setShowOverflow(false);
                      navigate(`/user/${meta.other_user!.user_id}`);
                    }}
                    className="w-full px-4 py-3 text-left text-caption text-ink-primary"
                  >
                    View profile
                  </button>
                )}
                {!isTeam && meta?.other_user && (
                  <button
                    onClick={() => {
                      setShowOverflow(false);
                      handleBlock();
                    }}
                    className="w-full px-4 py-3 text-left text-caption text-error"
                  >
                    Block user
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-3">
        {hasMore && (
          <button
            onClick={handleLoadOlder}
            disabled={loadingMore}
            className="w-full py-2 text-caption text-ink-muted text-center mb-2"
          >
            {loadingMore ? "Loading..." : "Load older messages"}
          </button>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((msg) => {
            const isMine = msg.sender_id === profile?.id;
            const displayText = msg.message_type === "nudge"
              ? (isMine ? `👊 You nudged${isTeam ? "" : ""}` : `👊 Nudged you`)
              : msg.message_type === "preset" && msg.message_key
                ? PRESET_MESSAGES[msg.message_key] || msg.message_key
                : msg.body || "";

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
              >
                {/* Sender name for team convos */}
                {isTeam && !isMine && (
                  <p className="text-micro text-ink-muted mb-0.5 px-1">{msg.sender_name}</p>
                )}
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
                    isMine
                      ? "bg-accent text-ink-inverse rounded-br-md"
                      : "bg-bg-elevated text-ink-primary rounded-bl-md"
                  }`}
                >
                  <p className="text-body">{displayText}</p>
                </div>
                <p className="text-micro text-ink-muted mt-0.5 px-1">
                  {isMine ? "You" : msg.sender_name.split(" ")[0]} · {formatTime(msg.created_at)}
                </p>
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Preset picker + nudge */}
      <div className="flex-shrink-0 border-t border-divider pt-2 pb-1">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {PRESET_KEYS.map((key) => {
            const emoji = PRESET_MESSAGES[key].split(" ").pop() || "";
            return (
              <button
                key={key}
                onClick={() => handleSendPreset(key)}
                disabled={sending}
                className="flex-shrink-0 w-11 h-11 rounded-full bg-bg-elevated flex items-center justify-center text-body-lg transition-all duration-200 ease-apple active:scale-90 disabled:opacity-50"
                title={PRESET_MESSAGES[key]}
              >
                {emoji}
              </button>
            );
          })}
          {/* Nudge button (DM only) */}
          {!isTeam && (
            <button
              onClick={handleNudge}
              disabled={nudgedToday || sending}
              className={`flex-shrink-0 px-4 h-11 rounded-pill text-caption font-semibold transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50 ${
                nudgedToday
                  ? "bg-bg-elevated text-ink-muted"
                  : "bg-accent/20 text-accent"
              }`}
            >
              {nudgedToday ? "Nudged ✓" : "Nudge 👊"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
