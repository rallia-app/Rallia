#!/usr/bin/env node
/**
 * App Store / Google Play screenshot generator for Rallia
 *
 * Design: dark showcase with colored glow behind device,
 *         aligned with @rallia/design-system tokens.
 *
 * Usage:  node scripts/generate-screenshots.mjs [--lang=en] [--theme=light] [--size=phone]
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'store', 'screenshots');

/* ── Logo (embedded as data-uri SVG) ───────────────────────────── */
const LOGO_SVG = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'images', 'logo-light.svg'),
  'utf-8',
);

/* ── Screenshot definitions ────────────────────────────────────── */
const SCREENSHOTS_EN = [
  {
    id: 'screenshot-1-home',
    sourceIphone: 'IMG_9838.PNG',
    sourceIpad: 'IMG_0042.PNG',
    headline: 'Find and join\ngames nearby',
    subtitle: 'Browse nearby matches, booked courts\nand open games at a glance.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-2-facilities',
    sourceIphone: 'IMG_9839.PNG',
    sourceIpad: 'IMG_0043.PNG',
    headline: 'Explore courts\naround you',
    subtitle: 'Check availability, distances\nand surface types.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-3-players',
    sourceIphone: 'IMG_9840.PNG',
    sourceIpad: 'IMG_0044.PNG',
    headline: 'Find players\nnear you',
    subtitle: 'Filter by level, sport and distance\nto find the perfect partner.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-4-chat',
    sourceIphone: 'IMG_9841.PNG',
    sourceIpad: 'IMG_0045.PNG',
    headline: 'Chat with\nyour opponents',
    subtitle: 'Message players, coordinate matches\nand stay in the loop.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-5-create',
    sourceIphone: 'IMG_9842.PNG',
    sourceIpad: 'IMG_0046.PNG',
    headline: 'Create a game\nin a few taps',
    subtitle: 'Pick the venue, time and format.\nInvite friends or open it to all.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
];

const SCREENSHOTS_FR = [
  {
    id: 'screenshot-1-home',
    sourceIphone: 'IMG_9843.PNG',
    sourceIpad: 'IMG_0037.PNG',
    headline: 'Trouvez et rejoignez\ndes parties près de vous',
    subtitle: 'Parcourez les parties, les terrains disponibles\net les matchs ouverts en un coup d\'œil.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-2-facilities',
    sourceIphone: 'IMG_9845.PNG',
    sourceIpad: 'IMG_0038.PNG',
    headline: 'Explorez les terrains\nautour de vous',
    subtitle: 'Consultez les disponibilités, distances\net types de surface.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-3-players',
    sourceIphone: 'IMG_9846.PNG',
    sourceIpad: 'IMG_0039.PNG',
    headline: 'Trouvez des joueurs\nprès de vous',
    subtitle: 'Filtrez par niveau, sport et distance\npour trouver le partenaire idéal.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-4-chat',
    sourceIphone: 'IMG_9847.PNG',
    sourceIpad: 'IMG_0040.PNG',
    headline: 'Discutez avec\nvos adversaires',
    subtitle: 'Échangez avec les joueurs, coordonnez\nvos parties et restez informé.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
  {
    id: 'screenshot-5-create',
    sourceIphone: 'IMG_9848.PNG',
    sourceIpad: 'IMG_0041.PNG',
    headline: 'Créez une partie\nen quelques taps',
    subtitle: 'Choisissez le lieu, l\'heure et le format.\nInvitez vos amis ou ouvrez-la à tous.',
    glow: '#0d9488', glowLight: '#5eead4', glowDark: '#0f766e',
  },
];

/* ── Themes ─────────────────────────────────────────────────────── */
const THEMES = {
  light: {
    bg: '#f0fdfa',
    text: '#0a0a0a',
    textShadow: 'rgba(0, 0, 0, 0.06)',
    phoneBg: '#fff',
    reflectionFrom: 'rgba(255, 255, 255, 0.15)',
    reflectionTo: 'rgba(255, 255, 255, 0.05)',
  },
  dark: {
    bg: '#0a0a0a',
    text: '#fafafa',
    textShadow: 'rgba(0, 0, 0, 0.3)',
    phoneBg: '#111',
    reflectionFrom: 'rgba(255, 255, 255, 0.08)',
    reflectionTo: 'rgba(255, 255, 255, 0.02)',
  },
};

/* ── CLI flags ─────────────────────────────────────────────────── */
const langFilter = process.argv.find(a => a.startsWith('--lang='));
const themeFilter = process.argv.find(a => a.startsWith('--theme='));
const LANGS = langFilter ? [langFilter.split('=')[1]] : ['en', 'fr'];
const THEME_NAMES = themeFilter ? [themeFilter.split('=')[1]] : ['light'];

/* ── Device sizes ──────────────────────────────────────────────── */
/* Only Apple-required sizes:
 *   iPhone 6.7": 1284 × 2778
 *   iPad 12.9":  2048 × 2732
 */
const SIZES = {
  iphone67: {
    device: 'iphone',
    width: 1284, height: 2778,
    phoneW: 840,  phoneH: 1820,
    headlineSize: 78, subtitleSize: 32,
    topPad: 110, gap: 44,
    bezel: 5, radius: 46, screenRadius: 41,
    logoH: 42, bottomPad: 60,
    glowRadius: 660,
  },
  ipad13: {
    device: 'ipad',
    width: 2048, height: 2732,
    phoneW: 1430,  phoneH: 1975,
    headlineSize: 96, subtitleSize: 40,
    topPad: 100, gap: 50,
    bezel: 6, radius: 52, screenRadius: 46,
    logoH: 50, bottomPad: 70,
    glowRadius: 800,
  },
};

/* ── HTML template ─────────────────────────────────────────────── */
function generateHTML(screenshot, imageDataUri, s, theme) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500&display=swap">
<style>

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${s.width}px;
    height: ${s.height}px;
    overflow: hidden;
    background: ${theme.bg};
    font-family: 'Inter', sans-serif;
  }

  .container {
    width: ${s.width}px;
    height: ${s.height}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }

  /* ── Bottom gradient ── */
  .gradient {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 55%;
    background: linear-gradient(to top, ${screenshot.glow}cc 0%, ${screenshot.glow}60 35%, transparent 100%);
    pointer-events: none;
  }

  /* ── Subtle noise texture overlay ── */
  .noise {
    position: absolute;
    inset: 0;
    opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 256px 256px;
    pointer-events: none;
  }

  /* ── Text area ── */
  .text-area {
    padding: 0 80px;
    text-align: center;
    z-index: 2;
    position: relative;
  }

  .headline {
    font-family: 'Poppins', sans-serif;
    font-size: ${s.headlineSize}px;
    font-weight: 800;
    color: ${theme.text};
    line-height: 1.1;
    letter-spacing: -0.05em;
    white-space: pre-line;
    text-shadow: 0 2px 8px ${theme.textShadow};
  }

  /* ── Phone wrapper ── */
  .phone-wrapper {
    position: relative;
    z-index: 2;
    margin-top: ${s.gap + Math.round(s.height * 0.03)}px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .phone-border {
    width: ${s.phoneW}px;
    height: ${s.phoneH}px;
    border-radius: ${Math.round(s.radius * 1.6)}px;

    background: linear-gradient(
      165deg,
      ${screenshot.glowLight} 0%,
      ${screenshot.glow} 30%,
      ${screenshot.glowDark} 60%,
      ${screenshot.glow} 75%,
      ${screenshot.glowLight} 100%
    );
    padding: ${Math.round(s.bezel * 2.2)}px;
    box-shadow:
      0 0 12px 2px ${screenshot.glow}60,
      0 0 30px 4px ${screenshot.glow}35,
      0 0 60px 8px ${screenshot.glow}18,
      0 20px 40px -8px rgba(0, 0, 0, 0.10);
    flex-shrink: 0;
  }

  .phone-frame {
    width: 100%;
    height: 100%;
    border-radius: ${Math.round(s.radius * 1.3)}px;
    overflow: hidden;
    background: ${theme.phoneBg};
    position: relative;
  }

  .phone-frame img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
  }

  /* ── Glass reflection ── */
  .phone-frame::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      125deg,
      ${theme.reflectionFrom} 0%,
      ${theme.reflectionTo} 25%,
      transparent 50%,
      transparent 100%
    );
    pointer-events: none;
    border-radius: ${Math.round(s.radius * 1.3)}px;
  }

</style>
</head>
<body>
<div class="container">
  <div class="gradient"></div>
  <div class="noise"></div>

  <div class="text-area">
    <div class="headline">${screenshot.headline}</div>
  </div>

  <div class="phone-wrapper">
    <div class="phone-border">
      <div class="phone-frame">
        <img class="phone-screen" src="${imageDataUri}" />
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

/* ── Main ──────────────────────────────────────────────────────── */
async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const sizeFilter = process.argv.find(a => a.startsWith('--size='));
  const onlySize = sizeFilter ? sizeFilter.split('=')[1] : null;

  for (const lang of LANGS) {
    const screenshots = lang === 'fr' ? SCREENSHOTS_FR : SCREENSHOTS_EN;

    for (const themeName of THEME_NAMES) {
      const theme = THEMES[themeName];

      for (const [sizeName, size] of Object.entries(SIZES)) {
        if (onlySize && sizeName !== onlySize) continue;

        const dir = path.join(ASSETS_DIR, 'generated', sizeName, `${lang}-${themeName}`);
        fs.mkdirSync(dir, { recursive: true });

        console.log(`\n=== ${sizeName} / ${lang} / ${themeName} (${size.width}x${size.height}) ===`);

        for (const screenshot of screenshots) {
          console.log(`  Generating ${screenshot.id}...`);

          // Pick source file based on device type (iphone vs ipad)
          const deviceSubdir = size.device === 'ipad' ? 'ipad' : 'iphone';
          const sourceFile = size.device === 'ipad' ? screenshot.sourceIpad : screenshot.sourceIphone;

          // Look for source in lang-theme specific folder, fall back to en-light
          const sourceDir = fs.existsSync(path.join(ASSETS_DIR, 'sources', `${lang}-${themeName}`, deviceSubdir))
            ? path.join(ASSETS_DIR, 'sources', `${lang}-${themeName}`, deviceSubdir)
            : path.join(ASSETS_DIR, 'sources', 'en-light', deviceSubdir);
          const sourcePath = path.join(sourceDir, sourceFile);
          const imageBuffer = fs.readFileSync(sourcePath);
          const imageDataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

          const page = await browser.newPage();
          await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });

          const html = generateHTML(screenshot, imageDataUri, size, theme);
          await page.setContent(html, { waitUntil: 'load', timeout: 60000 });

          await page.evaluate(() => document.fonts.ready);
          await new Promise(r => setTimeout(r, 800));

          const outputPath = path.join(dir, `${screenshot.id}.png`);
          await page.screenshot({ path: outputPath, type: 'png' });
          console.log(`    -> ${outputPath}`);

          await page.close();
        }
      }
    }
  }

  await browser.close();
  console.log('\nDone! Generated all screenshots.');
}

main().catch(console.error);
