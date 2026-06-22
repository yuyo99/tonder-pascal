"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";

/* ─── SVG Icon Components ─── */

function IconConcierge({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  );
}

function IconActivity({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconSettings({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconCollapseLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <path d="M16 15l-3-3 3-3" />
    </svg>
  );
}

/* ─── Pascal Logo ─── */

function PascalLogo({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/pascal-logo.svg"
        alt="Pascal"
        className="h-9 w-9 shrink-0"
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/pascal-logo.svg"
        alt="Pascal"
        className="h-10 w-10 shrink-0"
      />
      <div className="flex flex-col leading-none">
        <span className="text-[19px] font-bold text-gray-900 tracking-tight">
          pascal
        </span>
        <span className="mt-1.5 text-[9px] font-medium tracking-[0.18em] text-gray-400 uppercase">
          AI Support
        </span>
      </div>
    </div>
  );
}

/* ─── Nav Data ─── */

export interface NavItem {
  label: string;
  href: string;
  icon: (props: { className?: string }) => ReactNode;
}

// Exported so MobileTabBar shares the same nav source.
// Adding/removing a route here propagates to all nav surfaces.
export const AGENT_ITEMS: NavItem[] = [
  { label: "Concierge", href: "/concierge", icon: IconConcierge },
  { label: "Activity", href: "/concierge/activity", icon: IconActivity },
  { label: "Settings", href: "/concierge/settings", icon: IconSettings },
];

/* ─── Sidebar Component ─── */

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("pascal-sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("pascal-sidebar-collapsed", String(next));
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo + Live pill */}
      <div className={`flex items-center py-4 ${collapsed ? "px-2 justify-center" : "px-4 justify-between"}`}>
        <a href="/" className="flex items-center min-w-0" onClick={collapsed ? (e) => { e.preventDefault(); toggleCollapsed(); } : undefined}>
          <PascalLogo collapsed={collapsed} />
        </a>
        {!collapsed && (
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"
            style={{ boxShadow: "inset 0 0 0 1px rgba(5,150,105,0.3)" }}
          >
            Live
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {!collapsed && <div className="nav-section">Agent</div>}
        <div>
          {AGENT_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`nav-item ${active ? "active" : ""} ${collapsed ? "justify-center !px-0 !mx-2" : ""}`}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </div>
      </nav>

      {/* Footer — collapse toggle + sign out */}
      <div className={`flex items-center py-3 border-t border-gray-100 ${collapsed ? "px-2 flex-col gap-2" : "px-4 justify-between"}`}>
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconCollapseLeft className={`w-4 h-4 ${collapsed ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          title="Sign out"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile nav is handled by <MobileTabBar /> rendered in LayoutShell.
          The hamburger + slide-in drawer were removed in favor of the bottom
          tab bar (iOS-native pattern). Desktop sidebar below is unchanged. */}

      {/* Desktop sidebar — 232px expanded, 60px collapsed; matches Tonder design system */}
      <aside
        className={`hidden lg:flex flex-col bg-white border-r border-gray-200 transition-[width] duration-200 ease-out shrink-0 overflow-hidden ${
          collapsed ? "w-[60px]" : "w-[232px]"
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
