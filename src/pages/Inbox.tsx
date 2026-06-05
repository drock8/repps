import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { PRESET_MESSAGES } from "../lib/presets";
import { useAuth } from "../contexts/AuthContext";

interface InboxConversation {
  conversation_id: string;
  type: string;
  team_id: string | null;
  last_message: {
    message_type: string;
    message_key: string | null;
    body: string | null;
    sender_id: string;
    sender_name: string;
    created_at: string;
  };
  unread_count: number;
  other_user: {
    user_id: string;
    name: string;
    avatar_url: string | null;
  } | null;
  team_info: {
    team_name: string;
    member_count: number;
  } | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function messagePreview(msg: InboxConversation["last_message"], myId: string | undefined): string {
  if (msg.message_type === "nudge") {
    return msg.sender_id === myId
      ? `👊 You nudged`
      : `👊 Nudged you`;
  }
  if (msg.message_type === "preset" && msg.message_key) {
    const text = PRESET_MESSAGES[msg.message_key] || msg.message_key;
    return text;
  }
  if (msg.body) return msg.body;
  return "";
}

export default function Inbox() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInbox = useCallback(async () => {
    const { data } = await supabase.rpc("get_inbox");
    if (Array.isArray(data)) {
      setConversations(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // Realtime: refresh on new messages
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => { fetchInbox(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchInbox]);

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <p className="text-headline text-ink-primary mb-2">Messages</p>
        <p className="text-body text-ink-secondary text-center">
          Sign in to see your messages
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted mb-4">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-headline text-ink-primary mb-2">No messages yet</p>
        <p className="text-body text-ink-secondary text-center">
          Tap someone on the leaderboard to start a conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col pb-4">
      <p className="text-headline text-ink-primary mb-4">Messages</p>

      <div className="flex flex-col gap-1">
        {conversations.map((convo) => {
          const isUnread = convo.unread_count > 0;
          const displayName = convo.type === "team" && convo.team_info
            ? `${convo.team_info.team_name} (${convo.team_info.member_count})`
            : convo.other_user?.name || "Unknown";
          const avatarUrl = convo.type === "team" ? null : convo.other_user?.avatar_url || null;
          const preview = convo.last_message
            ? messagePreview(convo.last_message, profile.id)
            : "";
          const senderPrefix = convo.type === "team" && convo.last_message
            ? `${convo.last_message.sender_id === profile.id ? "You" : convo.last_message.sender_name.split(" ")[0]}: `
            : "";
          const time = convo.last_message ? timeAgo(convo.last_message.created_at) : "";

          return (
            <button
              key={convo.conversation_id}
              onClick={() => navigate(`/inbox/${convo.conversation_id}`)}
              className="w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-all duration-200 ease-apple active:bg-bg-elevated text-left"
            >
              {/* Avatar or team icon */}
              <div className="relative flex-shrink-0">
                {convo.type === "team" ? (
                  <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-12 h-12">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-avatar-bg flex items-center justify-center">
                        <span className="text-body-lg font-bold text-avatar-text">
                          {displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {isUnread && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-body truncate ${isUnread ? "text-ink-primary font-bold" : "text-ink-primary"}`}>
                    {displayName}
                  </p>
                  <span className="text-micro text-ink-muted flex-shrink-0">{time}</span>
                </div>
                <p className="text-caption text-ink-secondary truncate mt-0.5">
                  {senderPrefix}{preview}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
