import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import GenderPrompt from "./GenderPrompt";
import AddToHomeScreen from "./AddToHomeScreen";
import { useAuth } from "../contexts/AuthContext";

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/leaderboard": "Leaderboard",
  "/profile": "Profile",
  "/dab": "DAB",
};

export default function Layout() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const showGenderPrompt = profile && profile.gender_set === false;
  const title = PAGE_TITLES[pathname] || "";
  const scrollable = pathname === "/leaderboard";

  return (
    <div className={`h-screen bg-bg-base text-ink-primary flex flex-col ${scrollable ? "" : "overflow-hidden"}`}>
      <header className="sticky top-0 z-40 bg-bg-base flex-shrink-0">
        <div className="mx-auto max-w-md px-4 pt-4 pb-1">
          <div className="relative flex items-center justify-center h-7">
            <img src="/repps-logo.png" alt="REPPs" className="absolute left-0 h-8" />
            <span className="text-caption font-semibold text-ink-secondary uppercase tracking-wide">
              {title}
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md w-full px-4 pt-2 pb-24 flex-1">
        <Outlet />
      </main>
      {!showGenderPrompt && <BottomNav />}
      {showGenderPrompt && <GenderPrompt />}
      {profile && !showGenderPrompt && <AddToHomeScreen />}
    </div>
  );
}
