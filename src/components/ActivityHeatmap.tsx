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

function getDayLabel(dayIndex: number): string {
  return ["", "M", "", "W", "", "F", ""][dayIndex];
}

export default function ActivityHeatmap({ dailyCounts, months = 3 }: Props) {
  const [tooltip, setTooltip] = useState<{ day: string; count: number; x: number; y: number } | null>(null);

  const { weeks, monthLabels, maxCount } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const d of dailyCounts) {
      countMap.set(d.day, d.count);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    // Align to start of week (Sunday)
    start.setDate(start.getDate() - start.getDay());

    const weeks: { date: Date; dateStr: string; count: number }[][] = [];
    let currentWeek: { date: Date; dateStr: string; count: number }[] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    let maxCount = 0;

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
      if (count > maxCount) maxCount = count;

      currentWeek.push({ date: new Date(cursor), dateStr, count });

      if (cursor.getDay() === 6) {
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return { weeks, monthLabels, maxCount };
  }, [dailyCounts, months]);

  function getIntensity(count: number): string {
    if (count === 0) return "bg-bg-elevated";
    if (maxCount <= 1) return "bg-accent";
    const ratio = count / maxCount;
    if (ratio <= 0.25) return "bg-accent/25";
    if (ratio <= 0.5) return "bg-accent/50";
    if (ratio <= 0.75) return "bg-accent/75";
    return "bg-accent";
  }

  const cellSize = 13;
  const cellGap = 3;

  return (
    <div className="bg-bg-surface rounded-lg p-4">
      <p className="text-micro text-ink-muted uppercase tracking-wide mb-3">
        Activity
      </p>

      <div className="relative overflow-x-auto">
        <div className="inline-flex flex-col gap-0">
          {/* Month labels row */}
          <div className="flex items-end mb-1" style={{ paddingLeft: cellSize + cellGap }}>
            {monthLabels.map((m, i) => {
              const nextStart = monthLabels[i + 1]?.weekIndex ?? weeks.length;
              const span = nextStart - m.weekIndex;
              return (
                <span
                  key={m.label + m.weekIndex}
                  className="text-micro text-ink-muted"
                  style={{ width: span * (cellSize + cellGap), flexShrink: 0 }}
                >
                  {m.label}
                </span>
              );
            })}
          </div>

          {/* Grid: 7 rows (Sun-Sat) × N week columns */}
          <div className="flex gap-0">
            {/* Day labels */}
            <div className="flex flex-col" style={{ gap: cellGap, marginRight: cellGap }}>
              {Array.from({ length: 7 }, (_, i) => (
                <div
                  key={i}
                  className="text-micro text-ink-muted flex items-center justify-end"
                  style={{ width: cellSize, height: cellSize }}
                >
                  {getDayLabel(i)}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: cellGap, marginRight: wi < weeks.length - 1 ? cellGap : 0 }}>
                {Array.from({ length: 7 }, (_, di) => {
                  const day = week.find((d) => d.date.getDay() === di);
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
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-3">
        <span className="text-micro text-ink-muted mr-1">Less</span>
        <div className="w-3 h-3 rounded-sm bg-bg-elevated" />
        <div className="w-3 h-3 rounded-sm bg-accent/25" />
        <div className="w-3 h-3 rounded-sm bg-accent/50" />
        <div className="w-3 h-3 rounded-sm bg-accent/75" />
        <div className="w-3 h-3 rounded-sm bg-accent" />
        <span className="text-micro text-ink-muted ml-1">More</span>
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
