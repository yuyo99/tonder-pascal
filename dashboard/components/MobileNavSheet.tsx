"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AGENT_ITEMS, type NavItem } from "./Sidebar";

/**
 * Bottom sheet drawer triggered by the "More" tab on MobileTabBar.
 *
 * Lists all 16 nav entries grouped by section (Agent / Memory / QA /
 * Ops) so users can find less-frequent routes quickly without
 * remembering URLs. Slides up from the bottom of the viewport with a
 * dark backdrop; dismiss by tapping the backdrop or the close button.
 *
 * Pattern mirrors iOS native bottom sheets — rounded top corners,
 * grab-handle indicator at the top, smooth slide-in/out animation.
 */

interface NavGroup {
  label: string;
  hrefs: string[];
}

// Group the 16 routes into 4 sections. Order within each group matches
// the cognitive grouping from the /onboarding TOC pattern.
const GROUPS: NavGroup[] = [
  {
    label: "Agent",
    hrefs: ["/", "/onboarding", "/chat", "/analytics", "/brain", "/insights"],
  },
  {
    label: "Memory",
    hrefs: ["/memory", "/rules", "/profiles", "/procedures"],
  },
  {
    label: "QA",
    hrefs: ["/simulations", "/replays", "/training"],
  },
  {
    label: "Ops",
    hrefs: ["/merchants", "/people", "/monitoring"],
  },
];

function itemByHref(href: string): NavItem | undefined {
  return AGENT_ITEMS.find((i) => i.href === href);
}

export default function MobileNavSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  // Lock body scroll while the sheet is open so the page underneath
  // doesn't move when the user drags inside the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape to close — keyboards users / accessibility
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Backdrop — fades in/out; click to close */}
      <div
        onClick={onClose}
        className={`lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden
      />

      {/* Sheet */}
      <aside
        className={`lg:hidden fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl transform transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          paddingBottom: "var(--sab)",
          maxHeight: "85vh",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        {/* Drag handle indicator */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header with close */}
        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-base font-semibold text-gray-900">Navigation</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable groups */}
        <nav className="px-2 pb-3 overflow-y-auto" style={{ maxHeight: "65vh" }}>
          {GROUPS.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">
                {group.label}
              </p>
              {group.hrefs.map((href) => {
                const item = itemByHref(href);
                if (!item) return null;
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                      active
                        ? "bg-violet-50 text-violet-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="text-[15px] font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
