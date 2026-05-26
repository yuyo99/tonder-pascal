/**
 * Generates iOS PWA splash screens for modern iPhones (12 → 16 family).
 *
 * iOS Safari uses <link rel="apple-touch-startup-image"> with a media
 * query to pick the right splash for the device. If no entry matches,
 * Safari shows a brief white flash before the page renders. These six
 * PNGs cover every form factor Apple still ships software updates for
 * in the iPhone 12 — 16 lineup (regular / Pro / Plus / Pro Max).
 *
 * Output:
 *   public/splash/iphone-16-promax.png    1320×2868  (iPhone 16 Pro Max)
 *   public/splash/iphone-16-pro.png       1206×2622  (iPhone 16 Pro)
 *   public/splash/iphone-15-promax.png    1290×2796  (iPhone 14/15 Pro Max,
 *                                                      iPhone 15/16 Plus)
 *   public/splash/iphone-15-pro.png       1179×2556  (iPhone 14/15/16 Pro,
 *                                                      iPhone 15/16)
 *   public/splash/iphone-14-plus.png      1284×2778  (iPhone 12/13/14 Pro Max)
 *   public/splash/iphone-12.png           1170×2532  (iPhone 12/13/14 standard,
 *                                                      iPhone 12/13 Pro)
 *
 * The splash is the brand gradient (#38029d → #0d1227 top-to-bottom —
 * same as the app icon background + manifest background_color) with
 * the Pascal logo centered at ~30% of the screen width.
 *
 * Re-run: `node scripts/generate-splash-screens.js`
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_SVG = path.join(ROOT, "public/pascal-logo.svg");
const OUT_DIR = path.join(ROOT, "public/splash");

// Extract the embedded inner glyph from the source SVG. Same pattern
// as generate-icons.js — we re-wrap it inside a clean rounded gradient
// square so the logo sits centered on every splash.
const srcSvg = fs.readFileSync(SRC_SVG, "utf8");
const match = srcSvg.match(/xlink:href="(data:image\/png;base64,[^"]+)"/);
if (!match) {
  throw new Error("Could not extract embedded icon PNG from pascal-logo.svg");
}
const innerIconDataUrl = match[1];

/**
 * Build the centered Pascal logo as a square SVG. Used as a single
 * overlay across all splash sizes (sharp downscales per-device).
 */
function buildLogoSvg(size) {
  const innerSize = Math.round(size * 0.75);
  const innerPos = Math.round((size - innerSize) / 2);
  const corner = Math.round(size * 0.22);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="logoBg" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#38029d"/>
      <stop offset="1" stop-color="#0d1227"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${corner}" fill="url(#logoBg)"/>
  <image x="${innerPos}" y="${innerPos}" width="${innerSize}" height="${innerSize}" xlink:href="${innerIconDataUrl}"/>
</svg>`;
}

/**
 * Build a full-screen splash SVG: solid brand gradient background +
 * centered logo at ~30% of the smaller screen dimension.
 */
function buildSplashSvg(width, height) {
  const logoSize = Math.round(Math.min(width, height) * 0.3);
  const logoX = Math.round((width - logoSize) / 2);
  const logoY = Math.round((height - logoSize) / 2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0.5" x2="0.5" y2="1" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#38029d"/>
      <stop offset="1" stop-color="#0d1227"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
</svg>`;
}

/**
 * Render the splash by compositing the logo (rasterized at its
 * intended size) on top of the gradient background. We avoid base64
 * embedding the logo INSIDE the splash SVG because sharp re-rasterizes
 * the whole thing each call — composite is faster + cleaner output.
 */
async function renderSplash(width, height, outPath) {
  const logoPx = Math.round(Math.min(width, height) * 0.3);
  const logoBuf = await sharp(Buffer.from(buildLogoSvg(512)))
    .resize(logoPx, logoPx)
    .png()
    .toBuffer();

  await sharp(Buffer.from(buildSplashSvg(width, height)))
    .resize(width, height)
    .composite([
      {
        input: logoBuf,
        gravity: "center",
      },
    ])
    .png({ palette: true, colors: 64, quality: 80, effort: 9, compressionLevel: 9 })
    .toFile(outPath);

  const { size: bytes } = fs.statSync(outPath);
  console.log(
    `  ✓ ${path.relative(ROOT, outPath).padEnd(40)} ${String(width).padStart(4)}×${height}  ${(bytes / 1024).toFixed(1)} KB`
  );
}

const SCREENS = [
  { slug: "iphone-16-promax", width: 1320, height: 2868 },
  { slug: "iphone-16-pro", width: 1206, height: 2622 },
  { slug: "iphone-15-promax", width: 1290, height: 2796 },
  { slug: "iphone-15-pro", width: 1179, height: 2556 },
  { slug: "iphone-14-plus", width: 1284, height: 2778 },
  { slug: "iphone-12", width: 1170, height: 2532 },
];

async function main() {
  console.log("Generating Pascal iPhone splash screens...");
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const screen of SCREENS) {
    await renderSplash(
      screen.width,
      screen.height,
      path.join(OUT_DIR, `${screen.slug}.png`)
    );
  }

  console.log("Done. Re-run after editing public/pascal-logo.svg.");
}

main().catch((err) => {
  console.error("Splash generation failed:", err);
  process.exit(1);
});
