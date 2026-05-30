import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

type RepCallback = (payload: { user_id: string }) => void;

let channel: RealtimeChannel | null = null;
let subscribers = new Set<RepCallback>();
let subscribed = false;
const onSubscribeCallbacks: (() => void)[] = [];

function ensureChannel() {
  if (channel) return;
  channel = supabase
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
      if (status === "SUBSCRIBED") {
        subscribed = true;
        for (const cb of onSubscribeCallbacks) cb();
        onSubscribeCallbacks.length = 0;
      }
    });
}

function teardownIfEmpty() {
  if (subscribers.size === 0 && channel) {
    channel.unsubscribe();
    channel = null;
    subscribed = false;
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
