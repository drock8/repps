import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

let cachedIds: Set<string> | null = null;

export function useOG100() {
  const [ogIds, setOgIds] = useState<Set<string>>(cachedIds ?? new Set());

  useEffect(() => {
    if (cachedIds) return;

    supabase
      .from("public_profiles")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data) {
          cachedIds = new Set(data.map((r) => r.id));
          setOgIds(cachedIds);
        }
      });
  }, []);

  return ogIds;
}
