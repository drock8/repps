import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/leaderboard", label: "Leaderboard", icon: "🏆" },
  { to: "/", label: "Home", icon: "⚡", end: true },
  { to: "/profile", label: "Profile", icon: "👤" },
];

export default function BottomNav() {
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
              `flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[44px] transition-colors duration-200 ease-apple ${
                isActive ? "text-accent" : "text-ink-muted"
              }`
            }
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide">
              {tab.label}
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
