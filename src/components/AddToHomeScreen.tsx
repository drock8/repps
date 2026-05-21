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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 mb-6 w-full max-w-md bg-bg-surface rounded-2xl p-5 shadow-xl animate-[slideUp_300ms_ease-apple]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <img src={theme === "blue" ? "/repps-blue-icon-192.png" : "/repps-icon-192.png"} alt="REPPs" className="w-12 h-12 rounded-xl" />
            <div>
              <p className="text-body-lg font-bold text-ink-primary">Add REPPs to Home Screen</p>
              <p className="text-caption text-ink-muted mt-0.5">Quick access, full-screen experience</p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="ml-2 p-1 text-ink-muted transition-colors duration-200 ease-apple active:text-ink-primary"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isIOS ? (
          <div className="mt-4 flex items-center gap-2 text-caption text-ink-secondary">
            <span>Tap</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>then <strong>"Add to Home Screen"</strong></span>
          </div>
        ) : (
          <p className="mt-4 text-caption text-ink-secondary">
            Tap the menu button, then <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>
          </p>
        )}
      </div>
    </div>
  );
}
