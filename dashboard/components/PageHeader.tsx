"use client";

import type { ReactNode } from "react";

/**
 * Sticky page header — 56px tall, frosted glass, title | subtitle pattern
 * matching the Tonder design system spec §7. Sits at the top of each main
 * content column.
 *
 * Per Pascal design directive, the right-side slot is reserved for
 * page-specific actions (filters, export, "Add X" buttons). The Tonder
 * spec also surfaces a UTC pill, currency, notification bell, and avatar
 * on the right — those are intentionally omitted in Pascal.
 *
 * Usage:
 *   <PageHeader title="Memory" subtitle="Conversation history & knowledge entries" />
 *   <PageHeader title="Training" right={<button className="filter-btn">+ Add</button>} />
 */
export default function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header
      // min-h-14 (was h-14) so the safe-area-top padding can grow the
      // header without clipping content. The visible chrome below the
      // status bar still feels like the design-system 56px header.
      // Negative margin matches the parent's mobile (-4) / desktop (-8)
      // padding so the header expands to the full page width.
      className="sticky top-0 z-10 min-h-14 flex items-center justify-between gap-3 px-4 -mx-4 mb-4 sm:px-8 sm:-mx-8 sm:mb-6 py-2 sm:py-0"
      style={{
        background: "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(229, 231, 235, 0.6)",
        // Push the title content below the iPhone status bar / Dynamic
        // Island when running as an installed PWA with viewportFit:cover.
        // In a regular browser tab this resolves to 0.
        paddingTop: "calc(var(--sat) + 0.5rem)",
      }}
    >
      {/* Title block — stacks vertically on mobile, inline (pipe-
          separated) on sm+. */}
      <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 min-w-0">
        <h1 className="text-[15px] font-semibold text-gray-900 truncate">
          {title}
        </h1>
        {subtitle && (
          <>
            <span className="hidden sm:inline text-gray-300">|</span>
            <span className="text-[12px] sm:text-[13px] text-gray-400 truncate">
              {subtitle}
            </span>
          </>
        )}
      </div>
      {right && <div className="flex items-center gap-2.5 shrink-0">{right}</div>}
    </header>
  );
}
