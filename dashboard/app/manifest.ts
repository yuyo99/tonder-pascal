import type { MetadataRoute } from "next";

/**
 * Web App Manifest — drives "Install Pascal" in Chrome on macOS/Windows,
 * "Add to Home Screen" on iOS Safari, and "Add to Dock" in Safari on macOS
 * Sonoma+. Next.js auto-serves this at `/manifest.webmanifest`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pascal · AI Support",
    short_name: "Pascal",
    description:
      "Pascal — Tonder's AI Support agent. Live merchant channels, analytics, knowledge base, and team operations console.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Used for the splash screen / address bar / installed app frame.
    // Matches the deep-purple background of the rounded-square logo.
    background_color: "#0d1227",
    // Theme color matches Pascal's brand violet (also referenced in layout
    // metadata with a separate light-mode value via the `media` selector).
    theme_color: "#7c3aed",
    categories: ["productivity", "business"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Maskable variant — has the safe-zone inset so Android adaptive icons
        // can apply any mask shape without clipping the support-tech glyph.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
