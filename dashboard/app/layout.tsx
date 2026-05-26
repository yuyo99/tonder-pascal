import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import LayoutShell from "@/components/LayoutShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  // Title template — page-level `metadata.title` strings get formatted as
  // "[page] · Pascal" instead of replacing the whole title.
  title: {
    default: "Pascal · AI Support",
    template: "%s · Pascal",
  },
  description:
    "Pascal — Tonder's AI Support agent. Live merchant channels, analytics, knowledge base, and team operations console.",
  applicationName: "Pascal",
  // Next.js auto-injects <link rel="manifest"> when app/manifest.ts exists,
  // but declaring it here is explicit and survives the metadata API.
  manifest: "/manifest.webmanifest",
  // iOS / macOS Sonoma "Add to Dock" specific. The PNG fallbacks come from
  // app/apple-icon.png (Next.js convention) — these explicit entries let us
  // be precise about sizes if we ever ship multiple.
  appleWebApp: {
    capable: true,
    title: "Pascal",
    // black-translucent renders our page chrome under the iOS status bar,
    // giving a more native feel. Pair with viewport-fit=cover (below).
    statusBarStyle: "black-translucent",
  },
  // Hint to search engines + iOS Smart App Banner / Open Graph fallbacks.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Theme color is what the system uses for the title bar / status bar in
  // installed PWA contexts (macOS Sonoma "Add to Dock", iOS standalone mode,
  // Android Chrome). Different values for light vs. dark UI feel native.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1227" },
  ],
  // viewport-fit=cover lets the page extend behind iPhone notches / Dynamic
  // Island; we use this together with black-translucent status bar style.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gray-50 text-gray-900 min-h-screen flex">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
