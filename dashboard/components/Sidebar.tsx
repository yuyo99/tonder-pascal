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

function IconPeople({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function IconTraining({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function IconMonitoring({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconAIChat({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  );
}

function IconRules({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {/* shield + check — "rules guard Pascal's behavior" */}
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconProcedures({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {/* numbered playbook — "step-by-step procedures Pascal follows" */}
      <path d="M9 12h6" />
      <path d="M9 16h6" />
      <path d="M9 8h6" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h2" />
      <path d="M4 13h2" />
      <path d="M4 17h2" />
    </svg>
  );
}

function IconSimulations({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {/* beaker / lab flask — "regression simulations" */}
      <path d="M9 3v6l-4.5 9a1 1 0 00.87 1.5h13.26a1 1 0 00.87-1.5L15 9V3" />
      <path d="M8 3h8" />
      <path d="M7 15h10" />
    </svg>
  );
}

function IconProfiles({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {/* user card — "merchant profile cards Pascal references" */}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="11" r="2.5" />
      <path d="M5.5 17c.7-1.5 2-2.5 3.5-2.5s2.8 1 3.5 2.5" />
      <line x1="14.5" y1="9" x2="19" y2="9" />
      <line x1="14.5" y1="13" x2="18" y2="13" />
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

interface NavItem {
  label: string;
  href: string;
  icon: (props: { className?: string }) => ReactNode;
}

const AGENT_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: IconGrid },
  { label: "Chat", href: "/chat", icon: IconAIChat },
  { label: "Analytics", href: "/analytics", icon: IconChart },
  { label: "Brain", href: "/brain", icon: IconBrain },
  { label: "Memory", href: "/memory", icon: IconMemory },
  { label: "Rules", href: "/rules", icon: IconRules },
  { label: "Profiles", href: "/profiles", icon: IconProfiles },
  { label: "Procedures", href: "/procedures", icon: IconProcedures },
  { label: "Simulations", href: "/simulations", icon: IconSimulations },
  { label: "Training", href: "/training", icon: IconTraining },
  { label: "Merchant Chats", href: "/merchants", icon: IconChats },
  { label: "People", href: "/people", icon: IconPeople },
  { label: "Monitoring", href: "/monitoring", icon: IconMonitoring },
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
                onClick={() => setMobileOpen(false)}
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
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-gray-200"
      >
        <IconHamburger className="w-5 h-5 text-gray-600" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

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
