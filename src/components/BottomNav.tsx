import { NavLink } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";

type TabIcon =
  | { type: "img"; src: string }
  | { type: "svg"; d: string };

interface Tab {
  to: string;
  label: string;
  icon: TabIcon;
  end: boolean;
  disabled?: boolean;
}

const INBOX_ICON_D = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";
const TEAM_ICON_D = "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75";
const EVENTS_ICON_D = "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z";
const BOARD_ICON_D = "M18 20V10M12 20V4M6 20v-6";

const HOME_ICONS: Record<string, string> = {
  orange: "/icon-icon-orange.png",
  blue: "/Repps-Blue-Icon.png",
  yellow: "/Repps-Yellow-Icon.png",
};

function makeTabs(theme: string): Tab[] {
  return [
    { to: "/home", label: "Home", icon: { type: "img", src: HOME_ICONS[theme] || HOME_ICONS.orange }, end: true },
    { to: "/events", label: "Events", icon: { type: "svg", d: EVENTS_ICON_D }, end: false },
    { to: "/leaderboard", label: "Board", icon: { type: "svg", d: BOARD_ICON_D }, end: false },
    { to: "/team", label: "Teams", icon: { type: "svg", d: TEAM_ICON_D }, end: false },
    { to: "/inbox", label: "Inbox", icon: { type: "svg", d: INBOX_ICON_D }, end: false },
  ];
}

function TabIcon({ icon }: { icon: TabIcon }) {
  if (icon.type === "img") {
    return <img src={icon.src} alt="" className="h-6 w-6 object-contain" />;
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <path d={icon.d} />
    </svg>
  );
}

export default function BottomNav() {
  const theme = useTheme();
  const { profile } = useAuth();
  const tabs = makeTabs(theme);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    if (!profile) { setUnreadCount(0); return; }
    const { data } = await supabase.rpc("get_unread_count");
    if (data?.count !== undefined) setUnreadCount(data.count);
  }, [profile]);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  // Realtime: listen for new messages to update badge
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel("nav-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => { fetchUnread(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, fetchUnread]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-md bg-bg-surface border-t border-divider flex items-center justify-around"
        style={{ height: 60, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((tab) =>
          tab.disabled ? (
            <div
              key={tab.to}
              className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[44px] opacity-20 cursor-default"
            >
              <TabIcon icon={tab.icon} />
              <span className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
                {tab.label}
              </span>
            </div>
          ) : (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[44px] transition-opacity duration-200 ease-apple ${
                  isActive ? "opacity-100" : "opacity-40"
                }`
              }
            >
              <div className="relative">
                <TabIcon icon={tab.icon} />
                {tab.to === "/inbox" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-accent flex items-center justify-center">
                    <span className="text-[9px] font-bold text-ink-inverse leading-none">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  </span>
                )}
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wide text-accent">
                {tab.label}
              </span>
            </NavLink>
          )
        )}
      </div>
    </nav>
  );
}
