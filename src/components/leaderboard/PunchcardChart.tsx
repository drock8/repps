import { useMemo } from "react";

interface HeatmapCell {
  day: number; // 0=Mon, 6=Sun
  hour: number; // 0-23
  count: number;
}

interface PunchcardChartProps {
  data: HeatmapCell[];
  color: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = [
  "12am", "", "", "3am", "", "", "6am", "", "", "9am", "", "",
  "12pm", "", "", "3pm", "", "", "6pm", "", "", "9pm", "", "",
];

function peakSummary(data: HeatmapCell[]): string {
  if (data.length === 0) return "";
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const topCount = sorted[0].count;
  if (topCount === 0) return "";
  const threshold = topCount * 0.7;
  const peaks = sorted.filter(c => c.count >= threshold).slice(0, 6);

  const daySet = new Set(peaks.map(p => p.day));
  const hourSet = new Set(peaks.map(p => p.hour));
  const dayNames = [...daySet].sort((a, b) => a - b).map(d => DAYS[d]);
  const hours = [...hourSet].sort((a, b) => a - b);

  const formatHour = (h: number) => {
    if (h === 0) return "12am";
    if (h < 12) return `${h}am`;
    if (h === 12) return "12pm";
    return `${h - 12}pm`;
  };

  let hourRange: string;
  if (hours.length === 1) {
    hourRange = formatHour(hours[0]);
  } else {
    const min = hours[0];
    const max = hours[hours.length - 1];
    if (max - min <= 3) {
      hourRange = `${formatHour(min)}-${formatHour(max + 1)}`;
    } else {
      hourRange = `${formatHour(min)} & ${formatHour(max)}`;
    }
  }

  const dayStr = dayNames.length <= 2 ? dayNames.join(" & ") : dayNames.slice(0, 2).join(" & ") + " +";
  return `Most active: ${dayStr} ${hourRange}`;
}

export default function PunchcardChart({ data, color }: PunchcardChartProps) {
  const { grid, maxCount } = useMemo(() => {
    const g: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    let max = 0;
    for (const cell of data) {
      if (cell.day >= 0 && cell.day < 7 && cell.hour >= 0 && cell.hour < 24) {
        g[cell.hour][cell.day] = cell.count;
        if (cell.count > max) max = cell.count;
      }
    }
    return { grid: g, maxCount: max };
  }, [data]);

  const getLevel = (count: number): number => {
    if (count === 0 || maxCount === 0) return 0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.6) return 2;
    return 3;
  };

  const sizeMap = [0, 4, 7, 11];
  const opacityMap = [0, 0.2, 0.5, 1.0];

  const summary = useMemo(() => peakSummary(data), [data]);
  const prefersReducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cellSize = 18;
  const labelW = 36;
  const labelH = 16;
  const svgW = labelW + 7 * cellSize;
  const svgH = labelH + 24 * cellSize;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full max-w-[280px]"
        style={{ aspectRatio: `${svgW}/${svgH}` }}
      >
        {/* Day labels */}
        {DAYS.map((d, i) => (
          <text
            key={d}
            x={labelW + i * cellSize + cellSize / 2}
            y={12}
            textAnchor="middle"
            className="fill-ink-muted"
            style={{ fontSize: 8, fontFamily: "Inter, sans-serif" }}
          >
            {d}
          </text>
        ))}

        {/* Hour labels + dots */}
        {grid.map((row, hour) => (
          <g key={hour}>
            {HOUR_LABELS[hour] && (
              <text
                x={labelW - 4}
                y={labelH + hour * cellSize + cellSize / 2 + 3}
                textAnchor="end"
                className="fill-ink-muted"
                style={{ fontSize: 7, fontFamily: "Inter, sans-serif" }}
              >
                {HOUR_LABELS[hour]}
              </text>
            )}
            {row.map((count, day) => {
              const level = getLevel(count);
              const r = sizeMap[level] / 2;
              if (level === 0) {
                return (
                  <circle
                    key={day}
                    cx={labelW + day * cellSize + cellSize / 2}
                    cy={labelH + hour * cellSize + cellSize / 2}
                    r={1.5}
                    className="fill-ink-muted"
                    opacity={0.15}
                  />
                );
              }
              return (
                <circle
                  key={day}
                  cx={labelW + day * cellSize + cellSize / 2}
                  cy={labelH + hour * cellSize + cellSize / 2}
                  r={r}
                  fill={color}
                  opacity={opacityMap[level]}
                  className={prefersReducedMotion ? "" : "transition-all duration-300"}
                />
              );
            })}
          </g>
        ))}
      </svg>
      {summary && (
        <p className="text-micro text-ink-secondary mt-2">{summary}</p>
      )}
    </div>
  );
}
