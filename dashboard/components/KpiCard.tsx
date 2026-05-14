"use client";

import type { ReactNode } from "react";

/**
 * Shared KPI card used across /Overview, /Insights, and any future
 * dashboard section that wants the "label + big number + optional delta
 * + optional right slot" pattern.
 *
 * Values:
 *   - number  → formatted with toLocaleString()
 *   - string  → rendered as-is (e.g. "94.2%", "12m ago")
 *   - null    → renders a shimmer skeleton (loading state)
 *
 * Delta:
 *   - number  → arrow + signed value with color
 *   - "new"   → emerald "new" pill (used when previous period was 0)
 *   - null/undefined → nothing rendered
 *
 * Tone overrides the value color when set ('danger' = red).
 */
export interface KpiCardProps {
  label: string;
  value: number | string | null;
  delta?: number | "new" | null;
  deltaUnit?: string;   // e.g. "%" — appended after delta number
  deltaPositiveDirection?: "up" | "down"; // does up = good or bad? Default 'up' = good.
  delay?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  tone?: "neutral" | "danger" | "warn" | "good";
  right?: ReactNode;
  valueSuffix?: ReactNode; // e.g. small "(1 critical)" annotation
}

const VALUE_TONE: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  neutral: "text-gray-900",
  danger: "text-red-700",
  warn: "text-amber-700",
  good: "text-emerald-700",
};

export default function KpiCard({
  label,
  value,
  delta,
  deltaUnit,
  deltaPositiveDirection = "up",
  delay = 1,
  tone = "neutral",
  right,
  valueSuffix,
}: KpiCardProps) {
  return (
    <div className={`t-card fade-in d${delay}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p
          className={`text-[var(--text-metric)] font-semibold leading-tight ${VALUE_TONE[tone]}`}
        >
          {value === null
            ? (<span className="inline-block h-7 w-20 bg-gray-100 rounded animate-pulse" />)
            : typeof value === "number"
              ? value.toLocaleString()
              : value}
        </p>
        {valueSuffix}
      </div>
      {(delta !== undefined && delta !== null) && (
        <div className="mt-3 flex items-center justify-between">
          <DeltaPill delta={delta} unit={deltaUnit} direction={deltaPositiveDirection} />
          {right}
        </div>
      )}
      {(delta === undefined || delta === null) && right && (
        <div className="mt-3 flex items-center justify-between">
          <span />
          {right}
        </div>
      )}
    </div>
  );
}

function DeltaPill({
  delta,
  unit,
  direction,
}: {
  delta: number | "new";
  unit?: string;
  direction: "up" | "down";
}) {
  if (delta === "new") {
    return (
      <span className="t-badge t-badge-emerald text-[10px]">new</span>
    );
  }
  if (delta === 0) {
    return <span className="text-[11px] text-gray-400">no change</span>;
  }
  const goingUp = delta > 0;
  // When the metric is "lower is better" (e.g. error rate), direction='down'
  // means up is bad. Color follows is-the-change-good logic.
  const isGood = (direction === "up" && goingUp) || (direction === "down" && !goingUp);
  const cls = isGood ? "t-badge t-badge-emerald" : "t-badge t-badge-red";
  const sign = goingUp ? "+" : "";
  const arrow = goingUp ? "↗" : "↘";
  return (
    <span className={`${cls} text-[10px]`}>
      <span>{arrow}</span>
      <span>{sign}{delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit ?? ""}</span>
    </span>
  );
}
