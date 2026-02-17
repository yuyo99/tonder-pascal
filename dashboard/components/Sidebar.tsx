"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";

/* ─── SVG Icon Components ─── */

function IconGrid({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconStore({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <polyline points="9 22 9 12 15 12 15 22" />
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

function IconHamburger({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

/* ─── Pascal Logo ─── */

function PascalLogo({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0">
        {/* Shield shape */}
        <defs>
          <linearGradient id="shield-grad-sm" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <filter id="glow-sm">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M16 2 L28 8 L28 16 C28 23 22 28 16 30 C10 28 4 23 4 16 L4 8 Z"
          fill="url(#shield-grad-sm)"
          filter="url(#glow-sm)"
          opacity="0.9"
        />
        <text x="16" y="20" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="system-ui">P</text>
      </svg>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0">
        <defs>
          <linearGradient id="shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M16 2 L28 8 L28 16 C28 23 22 28 16 30 C10 28 4 23 4 16 L4 8 Z"
          fill="url(#shield-grad)"
          filter="url(#glow)"
          opacity="0.9"
        />
        <text x="16" y="20" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="system-ui">P</text>
      </svg>
      <span className="text-lg font-semibold text-white">
        Pascal<span className="text-violet-400">.</span>
      </span>
    </div>
  );
}

/* ─── Nav Data ─── */

interface NavItem {
  label: string;
  href: string;
  icon: (props: { className?: string }) => ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: IconGrid },
  { label: "Merchants", href: "/merchants", icon: IconStore },
];

/* ─── Sidebar Component ─── */

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
      {/* Logo area */}
      <div className={`flex items-center py-5 border-b border-white/[0.06] overflow-hidden ${collapsed ? "px-2 justify-center" : "px-4 justify-between"}`}>
        <a href="/" className="flex items-center" onClick={collapsed ? (e) => { e.preventDefault(); toggleCollapsed(); } : undefined}>
          <PascalLogo collapsed={collapsed} />
        </a>
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors"
            title="Collapse sidebar"
          >
            <IconCollapseLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 py-4 overflow-y-auto overflow-x-hidden ${collapsed ? "px-1" : "px-3"}`}>
        {!collapsed && (
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Main
          </p>
        )}

        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center gap-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  collapsed ? "px-0 justify-center" : "px-3"
                } ${
                  active
                    ? "bg-white/[0.07] text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-violet-400"
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                }`}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[11px] text-gray-500">Tonder Payment Assistant</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-lg bg-[#0f1629] shadow-lg border border-white/[0.08]"
      >
        <IconHamburger className="w-5 h-5 text-gray-300" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-[#0f1629] shadow-2xl transform transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-[#0f1629] border-r border-white/[0.06] transition-all duration-200 ease-out shrink-0 overflow-hidden ${
          collapsed ? "w-[60px]" : "w-[240px]"
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
