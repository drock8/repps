import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

type GenderFilter = "all" | "female" | "male" | "non_binary";
type TimePeriod = "daily" | "weekly" | "monthly" | "yearly" | "all";

interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  createdAt: string;
}

const GENDER_TABS: { label: string; value: GenderFilter }[] = [
  { label: "All", value: "all" },
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
];

const TIME_TABS: { label: string; value: TimePeriod }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
  { label: "All", value: "all" },
];

function getCutoff(period: TimePeriod): string | null {
  if (period === "all") return null;
  const ms: Record<Exclude<TimePeriod, "all">, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
    yearly: 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - ms[period]).toISOString();
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-accent text-ink-inverse flex items-center justify-center text-caption font-bold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function Leaderboard() {
  const { profile, signInWithGoogle } = useAuth();
  const [gender, setGender] = useState<GenderFilter>("all");
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [totalReps, setTotalReps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userEntry, setUserEntry] = useState<{
    rank: number;
    entry: LeaderboardEntry;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTotalReps = useCallback(async () => {
    const { count } = await supabase
      .from("reps")
      .select("*", { count: "exact", head: true });
    if (count !== null) setTotalReps(count);
  }, []);

  const fetchLeaderboard = useCallback(
    async (g: GenderFilter, p: TimePeriod) => {
      setLoading(true);
      const cutoff = getCutoff(p);

      let query = supabase
        .from("reps")
        .select(
          `
        user_id,
        validated_at,
        profiles!inner (
          id,
          name,
          avatar_url,
          gender,
          created_at
        )
      `
        );

      if (g !== "all") {
        query = query.eq("profiles.gender", g);
      }

      if (cutoff) {
        query = query.gte("validated_at", cutoff);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Leaderboard query error:", error);
        setEntries([]);
        setUserEntry(null);
        setLoading(false);
        return;
      }

      const grouped = new Map<
        string,
        { name: string; avatarUrl: string | null; count: number; createdAt: string }
      >();

      for (const row of data || []) {
        const prof = row.profiles as unknown as {
          id: string;
          name: string;
          avatar_url: string | null;
          gender: string;
          created_at: string;
        };
        const uid = row.user_id;
        const existing = grouped.get(uid);
        if (existing) {
          existing.count++;
        } else {
          grouped.set(uid, {
            name: prof.name,
            avatarUrl: prof.avatar_url,
            count: 1,
            createdAt: prof.created_at,
          });
        }
      }

      const sorted = Array.from(grouped.entries())
        .map(([userId, info]) => ({
          userId,
          name: info.name,
          avatarUrl: info.avatarUrl,
          count: info.count,
          createdAt: info.createdAt,
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.createdAt.localeCompare(b.createdAt);
        });

      const top50 = sorted.slice(0, 50);
      setEntries(top50);

      if (profile) {
        const userMatchesFilter =
          g === "all" || profile.gender === g;

        if (userMatchesFilter) {
          const userInTop50 = top50.some((e) => e.userId === profile.id);
          if (!userInTop50) {
            const userIdx = sorted.findIndex((e) => e.userId === profile.id);
            if (userIdx !== -1) {
              setUserEntry({ rank: userIdx + 1, entry: sorted[userIdx] });
            } else {
              setUserEntry({
                rank: sorted.length + 1,
                entry: {
                  userId: profile.id,
                  name: profile.name,
                  avatarUrl: profile.avatar_url,
                  count: 0,
                  createdAt: profile.created_at,
                },
              });
            }
          } else {
            setUserEntry(null);
          }
        } else {
          setUserEntry(null);
        }
      } else {
        setUserEntry(null);
      }

      setLoading(false);
    },
    [profile]
  );

  useEffect(() => {
    fetchTotalReps();
    fetchLeaderboard(gender, period);
  }, [gender, period, fetchLeaderboard, fetchTotalReps]);

  useEffect(() => {
    const channel = supabase
      .channel("leaderboard-reps")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reps" },
        () => {
          setTotalReps((prev) => prev + 1);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            fetchLeaderboard(gender, period);
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [gender, period, fetchLeaderboard]);

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.24)-theme(spacing.12))]">
      <div className="flex-shrink-0 bg-bg-base">
        <div className="flex flex-col items-center mt-2 mb-4">
          <p className="text-headline text-ink-primary">GBT</p>
          <p className="text-display-lg repps-gradient-text mt-1 tabular-nums">
            {formatNumber(totalReps)}
          </p>
          <p className="text-micro text-ink-secondary uppercase tracking-wide mt-1">
            Global Burpee Total
          </p>
        </div>

        <div className="flex gap-1 mb-3">
          {GENDER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setGender(tab.value)}
              className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                gender === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 mb-4">
          {TIME_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setPeriod(tab.value)}
              className={`flex-1 py-2 rounded-pill text-micro uppercase whitespace-nowrap transition-colors duration-200 ease-apple ${
                period === tab.value
                  ? "bg-accent text-ink-inverse font-bold"
                  : "bg-transparent text-ink-secondary font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
      {loading ? (
        <div className="py-12 text-center">
          <p className="text-body text-ink-muted">Loading...</p>
        </div>
      ) : entries.length === 0 && !userEntry ? (
        <div className="py-12 text-center">
          <p className="text-body text-ink-muted">
            No reps yet in this category. Be the first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <div
              key={entry.userId}
              className="flex items-center py-3 px-4 bg-bg-surface rounded-lg"
            >
              <span className="w-8 text-center flex-shrink-0">
                {i < 3 ? (
                  <span className="text-body-lg">{MEDALS[i]}</span>
                ) : (
                  <span className="text-body text-ink-muted">{i + 1}.</span>
                )}
              </span>
              <div className="ml-2">
                <Avatar url={entry.avatarUrl} name={entry.name} />
              </div>
              <span className="ml-3 text-body text-ink-primary truncate flex-1">
                {entry.name}
              </span>
              <span className="text-body text-accent font-bold tabular-nums ml-2">
                {entry.count}
              </span>
            </div>
          ))}

          {userEntry && (
            <div className="pt-2 mt-2">
              <p className="text-micro text-ink-secondary uppercase px-2 mb-1">
                YOU
              </p>
              <div className="flex items-center py-3 px-4 bg-bg-elevated rounded-lg border-t-2 border-accent">
                <span className="w-8 text-center flex-shrink-0 text-body text-ink-muted">
                  {userEntry.rank}.
                </span>
                <div className="ml-2">
                  <Avatar
                    url={userEntry.entry.avatarUrl}
                    name={userEntry.entry.name}
                  />
                </div>
                <span className="ml-3 text-body text-ink-primary truncate flex-1">
                  {userEntry.entry.name}
                </span>
                <span className="text-body text-accent font-bold tabular-nums ml-2">
                  {userEntry.entry.count}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!profile && (
        <div className="mt-8 text-center">
          <button
            onClick={signInWithGoogle}
            className="bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95 active:shadow-[0_0_40px_8px_rgba(var(--color-accent-glow-secondary),0.4)]"
          >
            Get on the leaderboard
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
