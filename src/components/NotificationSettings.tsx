import { useState } from "react";
import { useNotifications } from "../hooks/useNotifications";

export default function NotificationSettings() {
  const { prefs, permission, updatePrefs } = useNotifications();
  const [expanded, setExpanded] = useState(false);

  const unsupported = permission === "unsupported";
  const denied = permission === "denied";

  return (
    <div className="bg-bg-surface rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-secondary"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <div className="text-left">
            <p className="text-micro text-ink-muted uppercase tracking-wide">Reminders</p>
            <p className="text-body mt-0.5">
              {unsupported
                ? "Not supported"
                : prefs.enabled
                  ? `Daily at ${formatTime(prefs.reminderTime)}`
                  : "Off"}
            </p>
          </div>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {unsupported && (
            <p className="text-caption text-ink-muted">
              Your browser doesn't support notifications.
            </p>
          )}

          {denied && (
            <div className="bg-bg-elevated rounded-lg p-3">
              <p className="text-caption text-ink-secondary">
                Notifications are blocked. Open your browser settings to allow notifications for this site.
              </p>
            </div>
          )}

          {!unsupported && !denied && (
            <>
              {/* Daily reminder toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body text-ink-primary">Daily reminder</p>
                  <p className="text-caption text-ink-muted">
                    Nudge if you haven't hit your minimum
                  </p>
                </div>
                <button
                  onClick={() => updatePrefs({ enabled: !prefs.enabled })}
                  className={`relative w-12 h-7 rounded-full transition-colors duration-200 ease-apple ${
                    prefs.enabled ? "bg-accent" : "bg-bg-elevated"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ease-apple ${
                      prefs.enabled ? "translate-x-[1.25rem]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Reminder time */}
              {prefs.enabled && (
                <div className="bg-bg-elevated rounded-lg p-3">
                  <p className="text-micro text-ink-muted uppercase tracking-wide">Remind me at</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {["09:00", "12:00", "18:00", "20:00"].map((time) => (
                      <button
                        key={time}
                        onClick={() => updatePrefs({ reminderTime: time })}
                        className={`px-4 py-2 rounded-pill text-body font-semibold transition-all duration-200 ease-apple active:scale-95 ${
                          prefs.reminderTime === time
                            ? "bg-accent text-ink-inverse"
                            : "bg-bg-surface text-ink-secondary"
                        }`}
                      >
                        {formatTime(time)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3">
                    <label className="text-caption text-ink-muted">Custom time</label>
                    <input
                      type="time"
                      value={prefs.reminderTime}
                      onChange={(e) => {
                        if (e.target.value) updatePrefs({ reminderTime: e.target.value });
                      }}
                      className="w-full mt-1 bg-bg-input text-ink-primary text-body rounded-md px-4 py-2.5 outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              {/* Team nudges toggle */}
              {prefs.enabled && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-body text-ink-primary">Team nudges</p>
                    <p className="text-caption text-ink-muted">
                      Get notified when teammates nudge you
                    </p>
                  </div>
                  <button
                    onClick={() => updatePrefs({ teamNudges: !prefs.teamNudges })}
                    className={`relative w-12 h-7 rounded-full transition-colors duration-200 ease-apple ${
                      prefs.teamNudges ? "bg-accent" : "bg-bg-elevated"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ease-apple ${
                        prefs.teamNudges ? "translate-x-[1.25rem]" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
