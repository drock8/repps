import type { Gender } from "../contexts/AuthContext";

const STORAGE_KEY = "repps_guest_session";

export interface GuestSession {
  repIds: string[];
  repCount: number;
  gender?: Gender;
  timestamp: string;
}

export function getGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveGuestSession(session: GuestSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function addGuestRep(repId: string): void {
  const session = getGuestSession() || {
    repIds: [],
    repCount: 0,
    timestamp: new Date().toISOString(),
  };
  session.repIds.push(repId);
  session.repCount = session.repIds.length;
  saveGuestSession(session);
}

export function setGuestGender(gender: Gender): void {
  const session = getGuestSession();
  if (session) {
    session.gender = gender;
    saveGuestSession(session);
  }
}

export function clearGuestSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
