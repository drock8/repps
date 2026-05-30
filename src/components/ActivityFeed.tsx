import { useEffect, useState, useRef } from "react";
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
  duration: number;
  riseDistance: number;
  spawnedAt: number;
}

const MAX_BUBBLES = 10;
const MIN_DURATION = 10000;
const MAX_DURATION = 18000;
const BURST_WINDOW = 5000;
const BUBBLE_SIZE = 72;
const MAX_CACHE_SIZE = 200;

export default function ActivityFeed() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [hasReceivedRep, setHasReceivedRep] = useState(false);
  const profileCache = useRef<Map<string, ProfileCache>>(new Map());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .order("created_at", { ascending: false })
      .limit(MAX_CACHE_SIZE)
      .then(({ data }) => {
        if (data) {
          for (const p of data) {
            profileCache.current.set(p.id, { name: p.name, avatar_url: p.avatar_url });
          }
        }
      });

    async function getProfile(userId: string): Promise<ProfileCache> {
      const cached = profileCache.current.get(userId);
      if (cached) return cached;
      const { data } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", userId)
        .single();
      const result: ProfileCache = { name: data?.name || "Someone", avatar_url: data?.avatar_url || null };
      if (profileCache.current.size >= MAX_CACHE_SIZE) {
        const oldest = profileCache.current.keys().next().value;
        if (oldest) profileCache.current.delete(oldest);
      }
      profileCache.current.set(userId, result);
      return result;
    }

    function removeBubble(bubbleId: string) {
      setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
      timeoutsRef.current.delete(bubbleId);
    }

    async function spawnBubble(userId: string) {
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
        const left = 5 + Math.random() * 70;
        const duration = MIN_DURATION + Math.random() * (MAX_DURATION - MIN_DURATION);
        const riseDistance = window.innerHeight + 80;

        const newBubble: Bubble = {
          id: bubbleId,
          userId,
          name: profile.name,
          avatarUrl: profile.avatar_url,
          count: 1,
          left,
          duration,
          riseDistance,
          spawnedAt: now,
        };

        const timeout = setTimeout(() => removeBubble(bubbleId), duration);
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
    }

    const channel = supabase
      .channel("feed-reps")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        (payload) => {
          spawnBubble(payload.new.user_id as string);
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
  }, []);

  return (
    <>
      {!hasReceivedRep && bubbles.length === 0 && (
        <div className="h-24 flex items-center justify-center">
          <p className="text-body text-ink-muted">
            Be the first to drop a burpee
          </p>
        </div>
      )}

      {hasReceivedRep && bubbles.length === 0 && <div className="h-24" />}

      <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className="activity-bubble absolute flex flex-col items-center justify-center"
            style={{
              left: `${bubble.left}%`,
              bottom: `-${BUBBLE_SIZE}px`,
              width: `${BUBBLE_SIZE}px`,
              height: `${BUBBLE_SIZE}px`,
              "--rise-distance": `-${bubble.riseDistance}px`,
              animation: `bubble-rise ${bubble.duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
            } as React.CSSProperties}
          >
            {bubble.avatarUrl ? (
              <img
                src={bubble.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full text-ink-inverse flex items-center justify-center text-caption font-bold" style={{ backgroundColor: "rgba(var(--color-accent-glow), 0.8)" }}>
                {bubble.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-micro text-ink-primary/90 font-semibold leading-tight mt-0.5 max-w-full truncate px-1">
              {bubble.name.split(" ")[0]}
            </span>
            <span className="text-micro text-accent font-bold leading-tight">
              +{bubble.count}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
