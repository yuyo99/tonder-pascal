"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AGENT_ITEMS, type NavItem } from "./Sidebar";
import MobileNavSheet from "./MobileNavSheet";

/**
 * Bottom tab bar — iOS-native pattern. Shows 4 main tabs (Overview,
 * Chat, Analytics, Monitoring) plus a "More" tab that opens a bottom
 * sheet with the remaining nav entries. Hidden on lg+ where the
 * desktop Sidebar takes over.
 *
 * Fixed at the bottom of the viewport, respects safe-area-inset-bottom
 * so it sits above the iPhone home indicator. The LayoutShell adds a
 * spacer below the page content so the last bit of scroll doesn't
 * end up hidden under the bar.
 */

// The 4 main routes shown as tabs. Order = display order in the bar.
const TAB_HREFS = ["/", "/chat", "/analytics", "/monitoring"];

// Resolve to full NavItem objects (icon + label) once at module load.
const TABS: NavItem[] = TAB_HREFS.map((href) => {
  const item = AGENT_ITEMS.find((i) => i.href === href);
  if (!item) {
    throw new Error(
      `MobileTabBar: route ${href} not in Sidebar AGENT_ITEMS — keep these in sync.`
    );
  }
  return item;
});

function IconMore({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Login page should never show the tab bar
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // The "More" tab is "active" when the current route is one of the
  // less-frequent routes (anything not in the main 4 tabs and not /).
  const moreActive =
    pathname !== "/" && !TAB_HREFS.slice(1).some((h) => pathname.startsWith(h));

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-gray-200"
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          paddingBottom: "var(--sab)",
        }}
      >
        {TABS.map((t) => {
          const active = isActive(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                active ? "text-violet-600" : "text-gray-500"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="w-[22px] h-[22px]" />
              <span className="text-[10px] font-medium tracking-tight">
                {t.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
            moreActive ? "text-violet-600" : "text-gray-500"
          }`}
          aria-label="More navigation"
          aria-expanded={moreOpen}
        >
          <IconMore className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-medium tracking-tight">More</span>
        </button>
      </nav>
      <MobileNavSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
