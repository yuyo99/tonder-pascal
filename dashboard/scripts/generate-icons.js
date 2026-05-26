/**
 * Generates the Pascal app icons from the source logo at
 * `public/pascal-logo.svg`. Emits both a vector favicon (SVG — browser
 * scales perfectly to any tab size) and rasterized PNGs at the sizes
 * iOS / Android / macOS Sonoma expect.
 *
 * Output:
 *   app/icon.svg                   vector — Next.js auto-emits <link rel="icon"
 *                                  type="image/svg+xml">. Modern browsers
 *                                  prefer this; scales to any pixel size.
 *   app/apple-icon.png             180×180 — Apple-recommended size for iOS
 *                                  home-screen; iOS uses this directly with
 *                                  zero scaling artifacts.
 *   public/icon-192.png            192×192 — manifest icon (Chrome PWA install)
 *   public/icon-512.png            512×512 — manifest icon (Chrome PWA install
 *                                  / macOS Sonoma "Add to Dock")
 *   public/icon-maskable-512.png   512×512 — manifest icon with 10% safe-zone
 *                                  inset for Android adaptive masks
 *
 * PNG output is palette-quantized (256 colors) — the gradient background
 * compresses ~3× vs. full RGBA without visible degradation.
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
const originalInnerDataUrl = match[1];

// The original embedded PNG is 384×384 with full RGBA. For favicon use the
// browser is going to scale this down to 16–64px most of the time, so we
// re-encode at 192×192 with palette quantization. The SVG below uses two
// variants: the original full-resolution one for raster PNG outputs (where
// the wrapper is upscaled to 512×512), and the compact one for the vector
// favicon (where the inner raster is the dominant payload).
async function compactInnerIconDataUrl() {
  const originalPngBuf = Buffer.from(
    originalInnerDataUrl.replace(/^data:image\/png;base64,/, ""),
    "base64"
  );
  const compactBuf = await sharp(originalPngBuf)
    .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, colors: 64, quality: 80, effort: 10, compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${compactBuf.toString("base64")}`;
}

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
function buildIconSvg({ corner, safeZoneInset = 0, innerDataUrl }) {
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
  <image x="${iconPos}" y="${iconPos}" width="${iconSize}" height="${iconSize}" xlink:href="${innerDataUrl}"/>
</svg>`;
}

async function renderPng(svg, outPath, size) {
  // Race four encoder configs and ship whichever is smallest. PNG output
  // size for gradients depends weirdly on palette/effort/adaptiveFiltering
  // combos — empirically the winner varies per size, so just try them all.
  const baseSharp = () =>
    sharp(Buffer.from(svg)).resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

  const candidates = await Promise.all([
    baseSharp()
      .png({ palette: true, colors: 256, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer()
      .then((b) => ({ buf: b, label: "PNG8 q90" })),
    baseSharp()
      .png({ palette: true, colors: 128, quality: 80, effort: 10, compressionLevel: 9 })
      .toBuffer()
      .then((b) => ({ buf: b, label: "PNG8 q80" })),
    baseSharp()
      .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: false })
      .toBuffer()
      .then((b) => ({ buf: b, label: "PNG24" })),
    baseSharp()
      .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true })
      .toBuffer()
      .then((b) => ({ buf: b, label: "PNG24+ad" })),
  ]);

  candidates.sort((a, b) => a.buf.length - b.buf.length);
  const winner = candidates[0];
  fs.writeFileSync(outPath, winner.buf);
  console.log(
    `  ✓ ${path.relative(ROOT, outPath).padEnd(38)} ${String(size).padStart(3)}×${size}  ${winner.label.padEnd(8)}  ${(winner.buf.length / 1024).toFixed(1)} KB`
  );
}

function writeSvg(svg, outPath) {
  // Pretty SVGs are easy to inspect but full of whitespace; trim aggressively
  // since this file is shipped to every browser tab. Doesn't compress as well
  // as Brotli would, but ~2× smaller than the formatted output.
  const minified = svg
    .replace(/\n\s*/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
  fs.writeFileSync(outPath, minified);
  const { size: bytes } = fs.statSync(outPath);
  console.log(
    `  ✓ ${path.relative(ROOT, outPath).padEnd(38)} vector     ${(bytes / 1024).toFixed(1)} KB`
  );
}

async function main() {
  console.log("Generating Pascal app icons...");

  // Build the two SVG variants. The "rasterSvg" uses the full-resolution
  // 384×384 embedded PNG (sharp will downsample it cleanly to whatever
  // target size). The "faviconSvg" uses the compact 192×192 palette-
  // quantized version since the browser favicon UI rarely renders above
  // 64px — saves ~12 KB on every page load.
  const compactInnerUrl = await compactInnerIconDataUrl();
  const rasterStandardSvg = buildIconSvg({ corner: 110, innerDataUrl: originalInnerDataUrl });
  const rasterMaskableSvg = buildIconSvg({ corner: 0, safeZoneInset: 48, innerDataUrl: originalInnerDataUrl });
  const faviconSvg = buildIconSvg({ corner: 110, innerDataUrl: compactInnerUrl });

  // Vector favicon — Next.js auto-emits <link rel="icon" type="image/svg+xml">.
  // Modern browsers (Chrome/Edge/Firefox/Safari) prefer this and scale it
  // to whatever pixel size the tab/bookmarks UI wants — no rasterization
  // artifacts at 16px, 32px, or retina.
  writeSvg(faviconSvg, path.join(ROOT, "app/icon.svg"));

  // Apple touch icon — 180×180 is the modern iOS / macOS Sonoma standard
  await renderPng(rasterStandardSvg, path.join(ROOT, "app/apple-icon.png"), 180);

  // Manifest icons — referenced from app/manifest.ts
  await renderPng(rasterStandardSvg, path.join(ROOT, "public/icon-192.png"), 192);
  await renderPng(rasterStandardSvg, path.join(ROOT, "public/icon-512.png"), 512);
  await renderPng(rasterMaskableSvg, path.join(ROOT, "public/icon-maskable-512.png"), 512);

  // Remove the legacy 192×192 PNG favicon — the SVG above replaces it and
  // Next.js prefers SVG when both are present.
  const legacyPng = path.join(ROOT, "app/icon.png");
  if (fs.existsSync(legacyPng)) {
    fs.unlinkSync(legacyPng);
    console.log(`  ✗ removed legacy app/icon.png (replaced by icon.svg)`);
  }

  console.log("Done. Re-run after editing public/pascal-logo.svg.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
