import { useMemo } from "react";

interface DayData {
  day: string;
  count: number;
}

interface Props {
  dailyCounts: DayData[];
  weeks?: number;
}

export default function WeeklyTrendChart({ dailyCounts, weeks = 8 }: Props) {
  const weeklyData = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const d of dailyCounts) {
      countMap.set(d.day, d.count);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result: { label: string; total: number; weekStart: string }[] = [];

    for (let w = weeks - 1; w >= 0; w--) {
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      let total = 0;
      const cursor = new Date(weekStart);
      while (cursor <= weekEnd) {
        const dateStr = cursor.toISOString().slice(0, 10);
        total += countMap.get(dateStr) || 0;
        cursor.setDate(cursor.getDate() + 1);
      }

      const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      result.push({ label, total, weekStart: weekStart.toISOString().slice(0, 10) });
    }

    return result;
  }, [dailyCounts, weeks]);

  const maxTotal = Math.max(...weeklyData.map((w) => w.total), 1);
  const width = 280;
  const height = 80;
  const padX = 0;
  const padY = 4;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const points = weeklyData.map((w, i) => {
    const x = padX + (i / (weeklyData.length - 1)) * chartW;
    const y = padY + chartH - (w.total / maxTotal) * chartH;
    return { x, y, ...w };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

  return (
    <div className="bg-bg-surface rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-micro text-ink-muted uppercase tracking-wide">
          Weekly Trend
        </p>
        <p className="text-micro text-ink-muted">
          {weeklyData[weeklyData.length - 1].total} this week
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: 80 }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#trendFill)" />
        <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 4 : 2.5}
            fill={i === points.length - 1 ? "var(--color-accent)" : "var(--color-bg-surface)"}
            stroke="var(--color-accent)"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="flex justify-between mt-2">
        <span className="text-micro text-ink-muted">{weeklyData[0].label}</span>
        <span className="text-micro text-ink-muted">Now</span>
      </div>
    </div>
  );
}
