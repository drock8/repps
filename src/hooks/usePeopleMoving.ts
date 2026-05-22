import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";

let cachedMovers: number | null = null;

export function usePeopleMoving() {
  const [moverCount, setMoverCount] = useState(cachedMovers ?? 0);
  const moverSetRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    async function fetchMovers() {
      const { data } = await supabase
        .from("reps")
        .select("user_id");
      if (data && mountedRef.current) {
        moverSetRef.current = new Set(data.map((r) => r.user_id));
        const count = moverSetRef.current.size;
        cachedMovers = count;
        setMoverCount(count);
      }
    }

    fetchMovers();

    function handleVisibility() {
      if (document.visibilityState === "visible") fetchMovers();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("home-movers")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        (payload) => {
          const userId = payload.new?.user_id as string | undefined;
          if (!userId) return;
          if (!moverSetRef.current.has(userId)) {
            moverSetRef.current.add(userId);
            setMoverCount((prev) => {
              const next = prev + 1;
              cachedMovers = next;
              return next;
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          supabase
            .from("reps")
            .select("user_id")
            .then(({ data }) => {
              if (data && mountedRef.current) {
                moverSetRef.current = new Set(data.map((r) => r.user_id));
                const count = moverSetRef.current.size;
                cachedMovers = count;
                setMoverCount(count);
              }
            });
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  return moverCount;
}
