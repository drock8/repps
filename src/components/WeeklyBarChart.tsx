import { useMemo } from "react";

interface DayData {
  day: string;
  count: number;
}

interface Props {
  dailyCounts: DayData[];
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function WeeklyBarChart({ dailyCounts }: Props) {
  const days = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const d of dailyCounts) {
      countMap.set(d.day, d.count);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result: { label: string; count: number; isToday: boolean; dateStr: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      result.push({
        label: DAY_LABELS[d.getDay()],
        count: countMap.get(dateStr) || 0,
        isToday: i === 0,
        dateStr,
      });
    }
    return result;
  }, [dailyCounts]);

  const maxCount = Math.max(...days.map((d) => d.count), 1);

  return (
    <div className="bg-bg-surface rounded-lg p-4">
      <p className="text-micro text-ink-muted uppercase tracking-wide mb-3">
        Last 7 Days
      </p>
      <div className="flex items-end justify-between gap-1.5" style={{ height: 120 }}>
        {days.map((d) => {
          const barHeight = d.count === 0 ? 4 : Math.max(8, (d.count / maxCount) * 100);
          return (
            <div key={d.dateStr} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-micro tabular-nums text-ink-secondary font-medium">
                {d.count > 0 ? d.count : ""}
              </span>
              <div className="w-full flex items-end" style={{ height: 80 }}>
                <div
                  className={`w-full rounded-t-md transition-all duration-300 ease-apple ${
                    d.count === 0
                      ? "bg-bg-elevated border border-divider"
                      : d.isToday
                        ? "bg-accent"
                        : "bg-accent/60"
                  }`}
                  style={{ height: `${barHeight}%` }}
                />
              </div>
              <span
                className={`text-micro ${
                  d.isToday ? "text-accent font-bold" : "text-ink-muted"
                }`}
              >
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
