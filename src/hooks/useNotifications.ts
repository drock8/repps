import { useCallback, useEffect, useState } from "react";

const PREFS_KEY = "repps_notification_prefs";

export interface NotificationPrefs {
  enabled: boolean;
  reminderTime: string; // HH:mm format
  teamNudges: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  reminderTime: "18:00",
  teamNudges: true,
};

function loadPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: NotificationPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone === true);
}

export function getNotificationSupport(): { permission: NotificationPermission | "unsupported"; needsInstall: boolean } {
  if (!("Notification" in window)) {
    return { permission: "unsupported", needsInstall: isIOSSafari() && !isStandalone() };
  }
  return { permission: Notification.permission, needsInstall: false };
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  return getNotificationSupport().permission;
}

async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

function scheduleReminder(registration: ServiceWorkerRegistration, prefs: NotificationPrefs) {
  if (!prefs.enabled || !registration.active) return;

  const [hours, minutes] = prefs.reminderTime.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();

  registration.active.postMessage({
    type: "SCHEDULE_REMINDER",
    delayMs,
    title: "REPPs",
    body: "You haven't hit your daily minimum yet. Let's go! 💪",
  });
}

export function useNotifications() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);
  const [support, setSupport] = useState(getNotificationSupport);
  const permission = support.permission;
  const needsInstall = support.needsInstall;
  const setPermission = (p: NotificationPermission | "unsupported") =>
    setSupport((s) => ({ ...s, permission: p }));
  const [swRegistration, setSWRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    registerSW().then((reg) => {
      if (reg) setSWRegistration(reg);
    });
  }, []);

  useEffect(() => {
    if (!swRegistration || !prefs.enabled || permission !== "granted") return;
    scheduleReminder(swRegistration, prefs);
  }, [swRegistration, prefs, permission]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) return false;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result === "granted";
  }, []);

  const updatePrefs = useCallback(
    async (updates: Partial<NotificationPrefs>) => {
      const next = { ...prefs, ...updates };

      if (next.enabled && permission !== "granted") {
        const granted = await requestPermission();
        if (!granted) {
          next.enabled = false;
        }
      }

      if (next.enabled && !swRegistration) {
        const reg = await registerSW();
        if (reg) setSWRegistration(reg);
      }

      savePrefs(next);
      setPrefs(next);

      if (next.enabled && swRegistration) {
        scheduleReminder(swRegistration, next);
      }
    },
    [prefs, permission, requestPermission, swRegistration]
  );

  return { prefs, permission, needsInstall, updatePrefs };
}
