"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

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
          // Respect iPhone home indicator at the bottom and landscape
          // safe areas on the sides. Header takes care of top inset.
          paddingBottom: "var(--sab)",
          paddingLeft: "var(--sal)",
          paddingRight: "var(--sar)",
        }}
      >
        {/* Content rail — matches Tonder design system §5:
            max-width 1380px, px-8 py-6, gray-50 page bg (from body). */}
        <div className="max-w-[1380px] mx-auto px-8 py-6">{children}</div>
      </main>
    </>
  );
}
