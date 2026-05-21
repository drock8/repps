import { NavLink } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";

const TABS_ORANGE = [
  { to: "/leaderboard", label: "Leaderboard", icon: "/icon-leaderboard.png", end: false },
  { to: "/", label: "Home", icon: "/icon-home.png", end: true },
  { to: "/profile", label: "Profile", icon: "/icon-profile.png", end: false },
];

const TABS_BLUE = [
  { to: "/leaderboard", label: "Leaderboard", icon: "/Leaderboard-Blue-Icon.png", end: false },
  { to: "/", label: "Home", icon: "/Repps-Blue-Icon.png", end: true },
  { to: "/profile", label: "Profile", icon: "/Profile-Blue-Icon.png", end: false },
];

export default function BottomNav() {
  const theme = useTheme();
  const tabs = theme === "blue" ? TABS_BLUE : TABS_ORANGE;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-md bg-bg-surface border-t border-divider flex items-center justify-around"
        style={{ height: 60, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[44px] transition-opacity duration-200 ease-apple ${
                isActive ? "opacity-100" : "opacity-40"
              }`
            }
          >
            <img src={tab.icon} alt={tab.label} className="h-6 w-6 object-contain" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
              {tab.label}
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
