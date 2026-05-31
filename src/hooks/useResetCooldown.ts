import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "repps_reset_cooldown_until";
const COOLDOWN_SECONDS = 120;

function getRemaining(): number {
  const until = localStorage.getItem(STORAGE_KEY);
  if (!until) return 0;
  const left = Math.ceil((Number(until) - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

export function useResetCooldown() {
  const [cooldown, setCooldown] = useState(getRemaining);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(getRemaining()), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const startCooldown = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + COOLDOWN_SECONDS * 1000));
    setCooldown(COOLDOWN_SECONDS);
  }, []);

  return { cooldown, startCooldown };
}
