import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import BottomNav from "./BottomNav";
import GenderPrompt from "./GenderPrompt";
import FeedbackFAB from "./FeedbackFAB";
import ReferralQRModal from "./ReferralQRModal";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";

function getPageTitle(pathname: string): string {
  const titles: Record<string, string> = {
    "/home": "Home",
    "/leaderboard": "Leaderboard",
    "/profile": "Profile",
    "/dab": "DAB",
    "/team": "Teams",
    "/events": "Events",
  };
  if (pathname.startsWith("/team/join/")) return "Teams";
  if (pathname === "/events/create") return "Event";
  if (pathname.startsWith("/events/join/")) return "Events";
  if (pathname.startsWith("/events/")) return "Events";
  if (pathname.startsWith("/user/")) return "Profile";
  if (pathname === "/inbox") return "Messages";
  if (pathname.startsWith("/inbox/")) return "Messages";
  return titles[pathname] || "";
}

export default function Layout() {
  const { profile } = useAuth();
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showQR, setShowQR] = useState(false);
  const showGenderPrompt = profile && profile.gender_set === false && profile.gender === "unspecified";
  const title = getPageTitle(pathname);
  const scrollable = pathname === "/home" || pathname === "/leaderboard" || pathname === "/profile" || pathname === "/team" || pathname.startsWith("/team/join/") || pathname === "/events" || pathname.startsWith("/events/");
  const logo = theme === "blue" ? "/Repps-Blue-Logo.png"
    : theme === "yellow" ? "/Repps-Yellow-Logo.png"
    : "/repps-logo.png";

  return (
    <div className={`h-screen bg-bg-base text-ink-primary flex flex-col ${scrollable ? "" : "overflow-hidden"}`}>
      <header className="sticky top-0 z-40 bg-bg-base flex-shrink-0">
        <div className="mx-auto max-w-md px-4 pt-2 pb-1">
          <div className="relative flex items-center justify-center h-7">
            <img src={logo} alt="REPPs" className="absolute left-0 h-8" />
            <span className="text-caption font-semibold text-ink-secondary uppercase tracking-wide">
              {title}
            </span>
            {profile && (
              <div className="absolute right-0 flex items-center gap-2">
                <button
                  onClick={() => setShowQR(true)}
                  className="w-8 h-8 flex items-center justify-center text-ink-muted transition-colors duration-200 ease-apple active:text-accent"
                  title="Referral QR"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="8" height="8" rx="1" />
                    <rect x="14" y="2" width="8" height="8" rx="1" />
                    <rect x="2" y="14" width="8" height="8" rx="1" />
                    <rect x="14" y="14" width="4" height="4" />
                    <line x1="22" y1="14" x2="22" y2="18" />
                    <line x1="18" y1="22" x2="22" y2="22" />
                  </svg>
                </button>
                <button
                  onClick={() => navigate("/profile")}
                  className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 transition-all duration-200 ease-apple active:scale-90"
                >
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-avatar-bg flex items-center justify-center">
                      <span className="text-caption font-bold text-avatar-text">
                        {profile.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className={`mx-auto max-w-md w-full px-4 pt-3 flex-1 ${scrollable ? "pb-20 overflow-y-auto" : "pb-[68px] overflow-hidden"}`}>
        <Outlet />
      </main>
      {/* AddToHomeScreen — ready to enable when app is solid */}
      {/* {profile && !showGenderPrompt && <AddToHomeScreen />} */}
      {!showGenderPrompt && <BottomNav />}
      {showGenderPrompt && <GenderPrompt />}

      {!showGenderPrompt && <FeedbackFAB />}
      <ReferralQRModal open={showQR} onClose={() => setShowQR(false)} />
    </div>
  );
}
