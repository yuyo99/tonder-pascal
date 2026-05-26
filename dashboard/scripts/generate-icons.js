/**
 * Generates the Pascal app icons (favicon + Apple touch icon + PWA manifest
 * icons including a maskable variant) from the source logo at
 * `public/pascal-logo.svg`.
 *
 * Output:
 *   app/icon.png             192×192 — Next.js auto-emits <link rel="icon">
 *   app/apple-icon.png       180×180 — Next.js auto-emits <link rel="apple-touch-icon">
 *   public/icon-192.png      manifest icon (Chrome PWA install)
 *   public/icon-512.png      manifest icon (Chrome PWA install / macOS Sonoma "Add to Dock")
 *   public/icon-maskable-512.png   manifest icon with safe-zone padding (Android adaptive)
 *
 * Re-run: `node scripts/generate-icons.js`
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_SVG = path.join(ROOT, "public/pascal-logo.svg");

// Extract the embedded base64 PNG from the source SVG. The source SVG wraps
// it inside a rounded gradient square that's NOT centered (sits at translate
// 11,14 in a 534×512 viewBox) — we re-wrap it cleanly here so the gradient
// fills the full canvas with the icon perfectly centered.
const srcSvg = fs.readFileSync(SRC_SVG, "utf8");
const match = srcSvg.match(/xlink:href="(data:image\/png;base64,[^"]+)"/);
if (!match) {
  throw new Error("Could not extract embedded icon PNG from pascal-logo.svg");
}
const innerIconDataUrl = match[1];

/**
 * Build a square 512×512 icon SVG.
 *
 * @param {object} opts
 * @param {number} opts.corner       Rounded-corner radius in px (0 for maskable
 *                                   where the OS applies its own mask)
 * @param {number} opts.safeZoneInset
 *                                   Pixels of inset around the icon graphic.
 *                                   Maskable icons require ~10% safe zone on
 *                                   each side so OS masks don't crop the logo.
 */
function buildIconSvg({ corner, safeZoneInset = 0 }) {
  const iconSize = 384 - 2 * safeZoneInset;
  const iconPos = 64 + safeZoneInset;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#38029d"/>
      <stop offset="1" stop-color="#0d1227"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${corner}" fill="url(#bg)"/>
  <image x="${iconPos}" y="${iconPos}" width="${iconSize}" height="${iconSize}" xlink:href="${innerIconDataUrl}"/>
</svg>`;
}

// Standard icon — rounded corners look right on browsers/Android. macOS and
// iOS Safari apply their own squircle mask on top, so this still looks correct
// when installed.
const standardSvg = buildIconSvg({ corner: 110 });

// Maskable icon — flat (no built-in corner radius) with ~10% safe zone, so
// Android / Chrome can apply any adaptive mask shape without clipping the
// logo. Spec: https://web.dev/maskable-icon/
const maskableSvg = buildIconSvg({ corner: 0, safeZoneInset: 48 });

async function renderPng(svg, outPath, size) {
  await sharp(Buffer.from(svg))
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  ✓ ${path.relative(ROOT, outPath)}  (${size}×${size})`);
}

async function main() {
  console.log("Generating Pascal app icons...");

  // Favicon — Next.js looks for app/icon.{png,svg,...}
  await renderPng(standardSvg, path.join(ROOT, "app/icon.png"), 192);

  // Apple touch icon — 180×180 is the modern iOS / macOS Sonoma standard
  await renderPng(standardSvg, path.join(ROOT, "app/apple-icon.png"), 180);

  // Manifest icons — referenced from app/manifest.ts
  await renderPng(standardSvg, path.join(ROOT, "public/icon-192.png"), 192);
  await renderPng(standardSvg, path.join(ROOT, "public/icon-512.png"), 512);
  await renderPng(maskableSvg, path.join(ROOT, "public/icon-maskable-512.png"), 512);

  console.log("Done. Re-run after editing public/pascal-logo.svg.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
