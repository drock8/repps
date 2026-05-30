import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

let cachedMovers: number | null = null;

export function usePeopleMoving() {
  const [moverCount, setMoverCount] = useState(cachedMovers ?? 0);
  const knownUsersRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchCount = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_mover_count");
    if (!error && data !== null && mountedRef.current) {
      const count = Number(data);
      cachedMovers = count;
      setMoverCount(count);
      knownUsersRef.current.clear();
    }
  }, []);

  useEffect(() => {
    fetchCount();

    function handleVisibility() {
      if (document.visibilityState === "visible") fetchCount();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchCount]);

  const handleNewRep = useCallback((userId: string) => {
    if (!knownUsersRef.current.has(userId)) {
      knownUsersRef.current.add(userId);
      setMoverCount((prev) => {
        const next = prev + 1;
        cachedMovers = next;
        return next;
      });
    }
  }, []);

  return { moverCount, handleNewRep, refetchMovers: fetchCount };
}
