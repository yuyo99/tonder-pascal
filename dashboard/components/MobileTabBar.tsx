"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AGENT_ITEMS } from "./Sidebar";

/**
 * Bottom tab bar — iOS-native pattern. With only 3 nav entries
 * (Concierge / Activity / Settings) they all fit; no "More" sheet
 * needed. Hidden on lg+ where the desktop Sidebar takes over.
 *
 * Fixed at the bottom of the viewport, respects safe-area-inset-bottom
 * so it sits above the iPhone home indicator. The LayoutShell adds a
 * spacer below the page content so the last bit of scroll doesn't
 * end up hidden under the bar.
 */

export default function MobileTabBar() {
  const pathname = usePathname();

  // Login page should never show the tab bar
  if (pathname === "/login") return null;

  const isActive = (href: string) => {
    if (href === "/concierge") {
      // Exact match — don't claim activity/settings under Concierge.
      return pathname === "/concierge";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-gray-200"
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        paddingBottom: "var(--sab)",
      }}
    >
      {AGENT_ITEMS.map((t) => {
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
    </nav>
  );
}
