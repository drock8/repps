import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

interface ProfileCache {
  name: string;
  avatar_url: string | null;
}

interface Bubble {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  left: number;
  spawnedAt: number;
}

const MAX_BUBBLES = 10;
const BUBBLE_LIFETIME = 3000;
const BURST_WINDOW = 5000;

export default function ActivityFeed() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [hasReceivedRep, setHasReceivedRep] = useState(false);
  const profileCache = useRef<Map<string, ProfileCache>>(new Map());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, avatar_url");
    if (data) {
      for (const p of data) {
        profileCache.current.set(p.id, {
          name: p.name,
          avatar_url: p.avatar_url,
        });
      }
    }
  }, []);

  const getProfile = useCallback(async (userId: string): Promise<ProfileCache> => {
    const cached = profileCache.current.get(userId);
    if (cached) return cached;

    const { data } = await supabase
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", userId)
      .single();

    const profile: ProfileCache = {
      name: data?.name || "Someone",
      avatar_url: data?.avatar_url || null,
    };
    profileCache.current.set(userId, profile);
    return profile;
  }, []);

  const removeBubble = useCallback((bubbleId: string) => {
    setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
    timeoutsRef.current.delete(bubbleId);
  }, []);

  const spawnBubble = useCallback(
    async (userId: string) => {
      setHasReceivedRep(true);
      const profile = await getProfile(userId);
      const now = Date.now();

      setBubbles((prev) => {
        const existing = prev.find(
          (b) => b.userId === userId && now - b.spawnedAt < BURST_WINDOW
        );

        if (existing) {
          return prev.map((b) =>
            b.id === existing.id ? { ...b, count: b.count + 1 } : b
          );
        }

        const bubbleId = `${userId}-${now}`;
        const left = 5 + Math.random() * 75;

        const newBubble: Bubble = {
          id: bubbleId,
          userId,
          name: profile.name,
          avatarUrl: profile.avatar_url,
          count: 1,
          left,
          spawnedAt: now,
        };

        const timeout = setTimeout(() => removeBubble(bubbleId), BUBBLE_LIFETIME);
        timeoutsRef.current.set(bubbleId, timeout);

        const next = [...prev, newBubble];
        if (next.length > MAX_BUBBLES) {
          const removed = next.shift()!;
          const oldTimeout = timeoutsRef.current.get(removed.id);
          if (oldTimeout) {
            clearTimeout(oldTimeout);
            timeoutsRef.current.delete(removed.id);
          }
        }
        return next;
      });
    },
    [getProfile, removeBubble]
  );

  useEffect(() => {
    loadProfiles();

    const channel = supabase
      .channel("feed-reps")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        (payload) => {
          const userId = payload.new.user_id as string;
          spawnBubble(userId);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      for (const timeout of timeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      timeoutsRef.current.clear();
    };
  }, [loadProfiles, spawnBubble]);

  return (
    <div className="relative h-48 w-full overflow-hidden">
      {!hasReceivedRep && bubbles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-body text-ink-muted">
            Be the first to drop a burpee
          </p>
        </div>
      )}

      {bubbles.map((bubble) => (
        <div
          key={bubble.id}
          className="absolute bottom-4 rounded-pill px-4 py-2 bg-bg-elevated flex items-center gap-2"
          style={{
            left: `${bubble.left}%`,
            animation:
              "bubble-lifecycle 3000ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
          }}
        >
          {bubble.avatarUrl ? (
            <img
              src={bubble.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-accent text-ink-inverse flex items-center justify-center text-caption font-bold flex-shrink-0">
              {bubble.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-body text-ink-primary font-semibold whitespace-nowrap">
            {bubble.name}
          </span>
          <span className="text-accent font-bold whitespace-nowrap">
            +{bubble.count}
          </span>
        </div>
      ))}
    </div>
  );
}
