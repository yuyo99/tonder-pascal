"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import MobileTabBar from "./MobileTabBar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) {
    return <div className="w-full">{children}</div>;
  }

  return (
    <>
      <Sidebar />
      <main
        className="flex-1 min-h-screen overflow-auto"
        style={{
          // Landscape safe-areas on the sides. Bottom is handled by
          // the spacer below (which respects var(--sab) PLUS the
          // mobile tab bar height when present).
          paddingLeft: "var(--sal)",
          paddingRight: "var(--sar)",
        }}
      >
        {/* Content rail — Tonder design system §5: max-width 1380px,
            gray-50 page bg (from body). Mobile uses tighter padding
            (px-4 py-4) so cards aren't pinched by 32px margins on
            iPhone. Desktop keeps the original px-8 py-6. */}
        <div className="max-w-[1380px] mx-auto px-4 py-4 sm:px-8 sm:py-6">
          {children}
        </div>
        {/* Bottom spacer — clears the fixed MobileTabBar on mobile so
            the last bit of page scroll doesn't end up hidden under
            the bar. Tab bar is ~56px content + var(--sab) (home
            indicator). On lg+ where the tab bar isn't rendered, we
            still respect the home indicator via var(--sab). */}
        <div
          aria-hidden
          className="lg:hidden"
          style={{ height: "calc(56px + var(--sab))" }}
        />
        <div
          aria-hidden
          className="hidden lg:block"
          style={{ height: "var(--sab)" }}
        />
      </main>
      <MobileTabBar />
    </>
  );
}
