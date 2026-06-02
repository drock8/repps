import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";

const DISMISSED_KEY = "repps_a2hs_dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function AddToHomeScreen() {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const icon = theme === "blue" ? "/repps-blue-icon-192.png" : theme === "yellow" ? "/repps-yellow-icon-192.png" : "/repps-icon-192.png";

  return (
    <div className="w-full px-4 mt-3">
      <div className="flex items-center gap-3 bg-bg-surface rounded-lg px-3 py-2">
        <img src={icon} alt="REPPs" className="w-8 h-8 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-caption font-semibold text-ink-primary leading-tight">Add to Home Screen</p>
          <p className="text-micro text-ink-muted leading-tight mt-0.5">
            {isIOS ? (
              <>Tap <span className="inline-block align-middle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></span> then "Add to Home Screen"</>
            ) : (
              <>Tap menu → "Install app"</>
            )}
          </p>
        </div>
        <button
          onClick={dismiss}
          className="p-1 text-ink-muted active:text-ink-primary flex-shrink-0"
          aria-label="Dismiss"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
