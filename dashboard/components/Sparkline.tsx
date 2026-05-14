/**
 * Tiny SVG sparkline. No dependencies.
 *
 * Renders a smoothed line + soft fill underneath. Designed for the
 * 32-px hero-KPI slot in the Tonder design system §13A — same idea
 * as Chart.js sparklines, just hand-rolled in ~40 lines.
 */

type Color = "violet" | "emerald" | "red" | "amber" | "gray";

const STROKE: Record<Color, string> = {
  violet: "#7c3aed",
  emerald: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  gray: "#9ca3af",
};

const FILL: Record<Color, string> = {
  violet: "rgba(124, 58, 237, 0.18)",
  emerald: "rgba(16, 185, 129, 0.18)",
  red: "rgba(239, 68, 68, 0.18)",
  amber: "rgba(245, 158, 11, 0.18)",
  gray: "rgba(156, 163, 175, 0.18)",
};

export default function Sparkline({
  data,
  width = 112,
  height = 32,
  color = "violet",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: Color;
}) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pad = 2; // top/bottom inset so the stroke doesn't clip

  // Map values to screen coordinates. SVG y-axis is flipped, so invert.
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // Close the area path back along the bottom edge.
  const areaPath = `${linePath} L${width.toFixed(1)},${height.toFixed(1)} L0,${height.toFixed(1)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Trend sparkline"
    >
      <path d={areaPath} fill={FILL[color]} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={STROKE[color]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
