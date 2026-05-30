import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useRepsChannel } from "../hooks/useRepsChannel";

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

      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_gender: g === "all" ? null : g,
        p_period: p,
        p_limit: 50,
      });

      if (error) {
        console.error("Leaderboard query error:", error);
        setEntries([]);
        setUserEntry(null);
        setLoading(false);
        return;
      }

      const top50: LeaderboardEntry[] = (data || []).map(
        (row: { user_id: string; name: string; avatar_url: string | null; rep_count: number; created_at: string }) => ({
          userId: row.user_id,
          name: row.name,
          avatarUrl: row.avatar_url,
          count: row.rep_count,
          createdAt: row.created_at,
        })
      );

      setEntries(top50);

      if (profile) {
        const userMatchesFilter = g === "all" || profile.gender === g;

        if (userMatchesFilter) {
          const userInTop50 = top50.some((e) => e.userId === profile.id);
          if (!userInTop50) {
            const { data: rankData } = await supabase.rpc("get_user_rank", {
              p_user_id: profile.id,
              p_gender: g === "all" ? null : g,
              p_period: p,
            });
            const row = Array.isArray(rankData) ? rankData[0] : rankData;
            const rank = row?.rank ? Number(row.rank) : top50.length + 1;
            const userInList = top50.find((e) => e.userId === profile.id);
            setUserEntry({
              rank,
              entry: userInList ?? {
                userId: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                count: 0,
                createdAt: profile.created_at,
              },
            });
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

  useRepsChannel(
    useCallback(() => {
      setTotalReps((prev) => prev + 1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchLeaderboard(gender, period);
      }, 2000);
    }, [gender, period, fetchLeaderboard])
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.24)-theme(spacing.12))]">
      <div className="flex-shrink-0 bg-bg-base">
        <div className="relative flex flex-col items-center mt-2 mb-4">
          <img
            src="/Leaderboard-Mascot-Repps.png"
            alt=""
            className="absolute w-[4.5rem] left-[10px] top-1/2 -translate-y-1/2 pointer-events-none"
          />
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
