import { useState, useMemo } from "react";

interface DayData {
  day: string;
  count: number;
}

interface Props {
  dailyCounts: DayData[];
  months?: number;
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short" });
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export default function ActivityHeatmap({ dailyCounts, months = 3 }: Props) {
  const [tooltip, setTooltip] = useState<{ day: string; count: number; x: number; y: number } | null>(null);

  const { weeks, monthLabels, weekNumbers } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const d of dailyCounts) {
      countMap.set(d.day, d.count);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    // Align to start of week (Monday): getDay() returns 0=Sun, so Mon=1
    const dayOfWeek = start.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    start.setDate(start.getDate() - mondayOffset);

    const weeks: { date: Date; dateStr: string; count: number }[][] = [];
    let currentWeek: { date: Date; dateStr: string; count: number }[] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    const weekNumbers: { week: number; weekIndex: number }[] = [];
    let lastMonth = -1;
    const cursor = new Date(start);
    let weekIndex = 0;

    while (cursor <= today) {
      const month = cursor.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({ label: getMonthLabel(cursor), weekIndex });
        lastMonth = month;
      }

      const dateStr = cursor.toISOString().slice(0, 10);
      const count = countMap.get(dateStr) || 0;

      // Monday-based day index: Mon=0 .. Sun=6
      const mondayIndex = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
      currentWeek.push({ date: new Date(cursor), dateStr, count });

      if (mondayIndex === 6) {
        // End of week (Sunday) — record week number from the Monday of this week
        const monday = new Date(cursor);
        monday.setDate(monday.getDate() - 6);
        weekNumbers.push({ week: getISOWeekNumber(monday), weekIndex });
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      const monday = new Date(currentWeek[0].date);
      weekNumbers.push({ week: getISOWeekNumber(monday), weekIndex });
      weeks.push(currentWeek);
    }

    return { weeks, monthLabels, weekNumbers };
  }, [dailyCounts, months]);

  function getMondayIndex(date: Date): number {
    return date.getDay() === 0 ? 6 : date.getDay() - 1;
  }

  function getIntensity(count: number): string {
    if (count === 0) return "bg-bg-elevated border border-divider";
    if (count <= 10) return "bg-accent/20";
    if (count <= 25) return "bg-accent/35";
    if (count <= 50) return "bg-accent/55";
    if (count <= 75) return "bg-accent/75";
    return "bg-accent";
  }

  const cellSize = 13;
  const cellGap = 3;

  return (
    <div className="bg-bg-surface rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-micro text-ink-muted uppercase tracking-wide">
          Activity
        </p>
        <div className="flex items-center gap-1">
          <span className="text-micro text-ink-muted mr-1">0</span>
          <div className="w-2.5 h-2.5 rounded-sm bg-bg-elevated border border-divider" />
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/20" />
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/35" />
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/55" />
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/75" />
          <div className="w-2.5 h-2.5 rounded-sm bg-accent" />
          <span className="text-micro text-ink-muted ml-1">100+</span>
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <div className="inline-flex flex-col gap-0">
          {/* Month labels row */}
          <div className="flex items-end mb-1" style={{ paddingLeft: cellSize + cellGap }}>
            {monthLabels.map((m, i) => {
              const nextStart = monthLabels[i + 1]?.weekIndex ?? weeks.length;
              const span = nextStart - m.weekIndex;
              const widthPx = span * (cellSize + cellGap);
              return (
                <span
                  key={m.label + m.weekIndex}
                  className="text-micro text-ink-muted overflow-hidden"
                  style={{ width: widthPx, flexShrink: 0 }}
                >
                  {span >= 3 ? m.label : ""}
                </span>
              );
            })}
          </div>

          {/* Grid: 7 rows (Mon-Sun) × N week columns */}
          <div className="flex gap-0">
            {/* Day labels */}
            <div className="flex flex-col" style={{ gap: cellGap, marginRight: cellGap }}>
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-micro text-ink-muted flex items-center justify-end"
                  style={{ width: cellSize, height: cellSize }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: cellGap, marginRight: wi < weeks.length - 1 ? cellGap : 0 }}>
                {Array.from({ length: 7 }, (_, di) => {
                  const day = week.find((d) => getMondayIndex(d.date) === di);
                  if (!day) {
                    return <div key={di} style={{ width: cellSize, height: cellSize }} />;
                  }
                  return (
                    <button
                      key={di}
                      className={`rounded-sm transition-colors duration-150 ${getIntensity(day.count)}`}
                      style={{ width: cellSize, height: cellSize }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip(
                          tooltip?.day === day.dateStr
                            ? null
                            : { day: day.dateStr, count: day.count, x: rect.left + rect.width / 2, y: rect.top }
                        );
                      }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ day: day.dateStr, count: day.count, x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Week numbers row */}
          <div className="flex items-start mt-1" style={{ paddingLeft: cellSize + cellGap }}>
            {weekNumbers.map((wn, i) => {
              const showLabel = i === 0 || i === weekNumbers.length - 1 || i % 4 === 0;
              return (
                <div
                  key={wn.weekIndex}
                  className="text-micro text-ink-muted text-center"
                  style={{ width: cellSize + cellGap, flexShrink: 0 }}
                >
                  {showLabel ? wn.week : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-bg-elevated text-ink-primary text-caption px-3 py-1.5 rounded-md shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <span className="font-bold tabular-nums">{tooltip.count}</span>{" "}
          {tooltip.count === 1 ? "rep" : "reps"} on{" "}
          {new Date(tooltip.day + "T00:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </div>
      )}
    </div>
  );
}
