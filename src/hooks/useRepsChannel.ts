import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

type RepCallback = (payload: { user_id: string }) => void;

let channel: RealtimeChannel | null = null;
let subscribers = new Set<RepCallback>();
let subscribed = false;
let retryCount = 0;
const MAX_RETRIES = 5;
const onSubscribeCallbacks: (() => void)[] = [];

function createChannel(): RealtimeChannel {
  return supabase
    .channel("reps-global")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reps" },
      (payload) => {
        const userId = payload.new?.user_id as string;
        if (userId) {
          for (const cb of subscribers) cb({ user_id: userId });
        }
      }
    )
    .subscribe((status) => {
      console.log("[realtime] reps-global:", status);
      if (status === "SUBSCRIBED") {
        subscribed = true;
        retryCount = 0;
        for (const cb of onSubscribeCallbacks) cb();
        onSubscribeCallbacks.length = 0;
      }
      if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
        subscribed = false;
        channel?.unsubscribe();
        channel = null;
        if (subscribers.size > 0 && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.min(3000 * Math.pow(2, retryCount - 1), 30000);
          console.warn(`[realtime] reps-global lost, retry ${retryCount}/${MAX_RETRIES} in ${delay / 1000}s`);
          setTimeout(() => ensureChannel(), delay);
        }
      }
    });
}

function ensureChannel() {
  if (channel) return;
  channel = createChannel();
}

function teardownIfEmpty() {
  if (subscribers.size === 0 && channel) {
    channel.unsubscribe();
    channel = null;
    subscribed = false;
    retryCount = 0;
  }
}

export function useRepsChannel(
  callback: RepCallback,
  onSubscribed?: () => void
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const subscribedRef = useRef(onSubscribed);
  subscribedRef.current = onSubscribed;

  useEffect(() => {
    const wrapper: RepCallback = (p) => cbRef.current(p);
    subscribers.add(wrapper);
    ensureChannel();

    if (subscribedRef.current) {
      if (subscribed) {
        subscribedRef.current();
      } else {
        const fn = () => subscribedRef.current?.();
        onSubscribeCallbacks.push(fn);
      }
    }

    return () => {
      subscribers.delete(wrapper);
      teardownIfEmpty();
    };
  }, []);
}
