import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const PREFS_KEY = "repps_notification_prefs";
const LAST_REMINDED_KEY = "repps_last_reminded";
const VAPID_PUBLIC_KEY = "BN1rVtnGZN2iIssPHMUmZp7Pwz0Ewd7eQ0vdCB8V2bkGyfv824EZjp0vvC9cD-cl4ic8yL0VmW3A5SP7fnYdKEw";

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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  userId: string,
  prefs: NotificationPrefs,
): Promise<boolean> {
  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
    }

    const subJson = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint!,
        p256dh: subJson.keys!.p256dh!,
        auth: subJson.keys!.auth!,
        reminder_time: prefs.reminderTime + ":00",
        reminder_enabled: prefs.enabled,
        team_nudges: prefs.teamNudges,
      },
      { onConflict: "user_id,endpoint" },
    );
    return !error;
  } catch {
    return false;
  }
}

async function unsubscribeFromPush(userId: string) {
  await supabase.from("push_subscriptions").delete().eq("user_id", userId);
}

async function syncPrefsToServer(userId: string, prefs: NotificationPrefs) {
  await supabase
    .from("push_subscriptions")
    .update({
      reminder_time: prefs.reminderTime + ":00",
      reminder_enabled: prefs.enabled,
      team_nudges: prefs.teamNudges,
    })
    .eq("user_id", userId);
}

// Client-side fallback: check on app open
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function alreadyRemindedToday(): boolean {
  return localStorage.getItem(LAST_REMINDED_KEY) === todayKey();
}

function markRemindedToday() {
  localStorage.setItem(LAST_REMINDED_KEY, todayKey());
}

function isPastReminderTime(reminderTime: string): boolean {
  const [h, m] = reminderTime.split(":").map(Number);
  const now = new Date();
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

async function getTodayRepCount(userId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("reps")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("validated_at", todayStart.toISOString());
  return count ?? 0;
}

async function getDailyTarget(): Promise<number> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "team_daily_target")
    .single();
  return data ? Number(data.value) : 5;
}

async function showLocalNotification(registration: ServiceWorkerRegistration, title: string, body: string) {
  if (registration.active) {
    registration.active.postMessage({ type: "SHOW_NOTIFICATION", title, body, tag: "daily-reminder" });
  }
}

async function checkAndNotify(
  prefs: NotificationPrefs,
  userId: string | undefined,
  registration: ServiceWorkerRegistration | null,
) {
  if (!prefs.enabled || !userId || !registration) return;
  if (!isPastReminderTime(prefs.reminderTime)) return;
  if (alreadyRemindedToday()) return;

  const [todayCount, target] = await Promise.all([
    getTodayRepCount(userId),
    getDailyTarget(),
  ]);

  if (todayCount >= target) return;

  markRemindedToday();

  const remaining = target - todayCount;
  const body = todayCount === 0
    ? `Time to start! Hit your ${target} daily reps.`
    : `${remaining} more rep${remaining === 1 ? "" : "s"} to hit your daily minimum. Let's go!`;

  await showLocalNotification(registration, "REPPs", body);
}

export function useNotifications(userId?: string) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);
  const [support, setSupport] = useState(getNotificationSupport);
  const permission = support.permission;
  const needsInstall = support.needsInstall;
  const setPermission = (p: NotificationPermission | "unsupported") =>
    setSupport((s) => ({ ...s, permission: p }));
  const [swRegistration, setSWRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    registerSW().then((reg) => {
      if (reg) setSWRegistration(reg);
    });
  }, []);

  // Client-side fallback check
  useEffect(() => {
    if (!prefs.enabled || permission !== "granted") return;

    const check = () => checkAndNotify(prefs, userId, swRegistration);
    check();

    function handleVisibility() {
      if (document.visibilityState === "visible") check();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    checkIntervalRef.current = setInterval(check, 15 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, [prefs, permission, userId, swRegistration]);

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

      let reg = swRegistration;
      if (next.enabled && !reg) {
        reg = await registerSW();
        if (reg) setSWRegistration(reg);
      }

      savePrefs(next);
      setPrefs(next);

      // Subscribe/unsubscribe from server push
      if (userId && reg) {
        if (next.enabled) {
          await subscribeToPush(reg, userId, next);
        } else {
          await unsubscribeFromPush(userId);
        }
      } else if (userId && next.enabled) {
        await syncPrefsToServer(userId, next);
      }
    },
    [prefs, permission, requestPermission, swRegistration, userId]
  );

  return { prefs, permission, needsInstall, updatePrefs };
}
