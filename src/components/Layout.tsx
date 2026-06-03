import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import GenderPrompt from "./GenderPrompt";


import FeedbackFAB from "./FeedbackFAB";
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
  return titles[pathname] || "";
}

export default function Layout() {
  const { profile } = useAuth();
  const theme = useTheme();
  const { pathname } = useLocation();
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
          </div>
        </div>
      </header>
      <main className={`mx-auto max-w-md w-full px-4 pt-3 flex-1 ${scrollable ? "pb-24 overflow-y-auto" : "pb-[68px] overflow-hidden"}`}>
        <Outlet />
      </main>
      {/* AddToHomeScreen — ready to enable when app is solid */}
      {/* {profile && !showGenderPrompt && <AddToHomeScreen />} */}
      {!showGenderPrompt && <BottomNav />}
      {showGenderPrompt && <GenderPrompt />}

      {!showGenderPrompt && <FeedbackFAB />}
    </div>
  );
}
