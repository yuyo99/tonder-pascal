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

function IconChats({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function IconChart({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconBrain({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="6" cy="14" r="2" />
      <circle cx="18" cy="16" r="2" />
      <line x1="8" y1="6" x2="16" y2="8" />
      <line x1="6" y1="8" x2="6" y2="12" />
      <line x1="7.5" y1="15" x2="10.5" y2="17.5" />
      <line x1="13.5" y1="17.5" x2="16.5" y2="16" />
      <line x1="17.5" y1="10" x2="17.5" y2="14" />
    </svg>
  );
}

function IconMemory({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function IconOnboarding({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12l2 2 4-4" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}

function IconIntegrations({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <path d="M8 21H3v-5" />
      <line x1="3" y1="21" x2="10" y2="14" />
      <path d="M21 16v5h-5" />
      <line x1="21" y1="21" x2="14" y2="14" />
      <path d="M3 8V3h5" />
      <line x1="3" y1="3" x2="10" y2="10" />
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
    // Minimal: dark circle with two violet glowing eyes
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0">
        <circle cx="16" cy="16" r="15" fill="#1e1b4b" stroke="#312e81" strokeWidth="0.5" />
        {/* Left eye */}
        <ellipse cx="11" cy="16" rx="3.5" ry="3" fill="#6d28d9" opacity="0.4" />
        <ellipse cx="11" cy="16" rx="2.5" ry="2" fill="#8b5cf6" />
        <ellipse cx="11" cy="15.5" rx="1" ry="0.75" fill="#ede9fe" />
        {/* Right eye */}
        <ellipse cx="21" cy="16" rx="3.5" ry="3" fill="#6d28d9" opacity="0.4" />
        <ellipse cx="21" cy="16" rx="2.5" ry="2" fill="#8b5cf6" />
        <ellipse cx="21" cy="15.5" rx="1" ry="0.75" fill="#ede9fe" />
      </svg>
    );
  }

  // Full robot head + "Pascal." text
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 120 120" className="h-8 w-8 shrink-0" fill="none">
        <circle cx="60" cy="60" r="58" fill="#1e1b4b" />
        <circle cx="60" cy="60" r="58" stroke="#312e81" strokeWidth="2" />
        <rect x="30" y="32" width="60" height="56" rx="12" fill="#1e1b4b" stroke="#312e81" strokeWidth="1.5" />
        <rect x="36" y="36" width="48" height="14" rx="4" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
        {/* Left eye */}
        <ellipse cx="44" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" />
        <ellipse cx="44" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
        <ellipse cx="44" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
        <ellipse cx="44" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
        {/* Right eye */}
        <ellipse cx="76" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" />
        <ellipse cx="76" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
        <ellipse cx="76" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
        <ellipse cx="76" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
        {/* Mouth grill */}
        <rect x="42" y="74" width="36" height="8" rx="3" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
        <line x1="50" y1="74" x2="50" y2="82" stroke="#312e81" strokeWidth="0.5" />
        <line x1="58" y1="74" x2="58" y2="82" stroke="#312e81" strokeWidth="0.5" />
        <line x1="66" y1="74" x2="66" y2="82" stroke="#312e81" strokeWidth="0.5" />
        <line x1="74" y1="74" x2="74" y2="82" stroke="#312e81" strokeWidth="0.5" />
        {/* Antenna */}
        <line x1="60" y1="32" x2="60" y2="20" stroke="#312e81" strokeWidth="2" />
        <circle cx="60" cy="18" r="4" fill="#6d28d9" opacity="0.8" />
        <circle cx="60" cy="18" r="2" fill="#8b5cf6" />
        {/* Ear pieces */}
        <rect x="22" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
        <rect x="90" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
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

const AGENT_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: IconGrid },
  { label: "Analytics", href: "/analytics", icon: IconChart },
  { label: "Brain", href: "/brain", icon: IconBrain },
  { label: "Memory", href: "/memory", icon: IconMemory },
  { label: "Chats", href: "/merchants", icon: IconChats },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Onboarding", href: "/onboarding", icon: IconOnboarding },
  { label: "Integrations", href: "/integrations", icon: IconIntegrations },
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
        {/* Agent section */}
        {!collapsed && (
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Agent
          </p>
        )}
        <div className="space-y-0.5">
          {AGENT_ITEMS.map((item) => {
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

        {/* Admin section */}
        {!collapsed && (
          <p className="px-3 mt-5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Admin
          </p>
        )}
        {collapsed && <div className="mt-3" />}
        <div className="space-y-0.5">
          {ADMIN_ITEMS.map((item) => {
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
            <p className="text-[11px] text-gray-500">Tonder AI Agent</p>
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
