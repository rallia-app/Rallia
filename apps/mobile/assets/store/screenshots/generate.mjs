#!/usr/bin/env node
/**
 * Google Play Store screenshot generator for Rallia
 * Wraps real app screenshots in promotional frames at 1080x1920 (9:16 portrait)
 *
 * Usage: node generate.mjs
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCREENSHOTS = [
  {
    id: 'screenshot-1-home',
    source: 'IMG_9786.PNG',
    headline: 'Find and join\ngames nearby',
    subtitle: 'Browse nearby matches, booked courts\nand open games at a glance.',
    gradient: ['#0d9488', '#14b8a6', '#2dd4bf'],
  },
  {
    id: 'screenshot-2-players',
    source: 'IMG_9784.PNG',
    headline: 'Find players\nnear you',
    subtitle: 'Filter by level, sport and distance\nto find the perfect partner.',
    gradient: ['#14b8a6', '#0ea5e9', '#38bdf8'],
  },
  {
    id: 'screenshot-3-facilities',
    source: 'IMG_9785.PNG',
    headline: 'Explore courts\naround you',
    subtitle: 'Check availability, distances\nand surface types.',
    gradient: ['#f59e0b', '#fbbf24', '#fcd34d'],
  },
  {
    id: 'screenshot-4-create',
    source: 'IMG_9787.PNG',
    headline: 'Create a game\nin a few taps',
    subtitle: 'Pick the venue, time and format.\nInvite friends or open it to all.',
    gradient: ['#ed6a6d', '#f1888a', '#fca5a5'],
  },
  {
    id: 'screenshot-5-detail',
    source: 'IMG_9788.PNG',
    headline: 'All the info\non every court',
    subtitle: 'Map, court count, availability\nand nearby matches.',
    gradient: ['#7c3aed', '#8b5cf6', '#a78bfa'],
  },
];

const SIZES = {
  phone:    { width: 1080, height: 1920, phoneW: 700, phoneH: 1460, fontSize: 56, subSize: 24, topPad: 50, gap: 60, radius: 56, screenRadius: 46, notchW: 160, notchH: 32, notchTop: 22, framePad: 12 },
  tablet7:  { width: 1200, height: 1920, phoneW: 620, phoneH: 1300, fontSize: 52, subSize: 22, topPad: 50, gap: 50, radius: 50, screenRadius: 42, notchW: 140, notchH: 28, notchTop: 20, framePad: 11 },
  tablet10: { width: 1600, height: 2560, phoneW: 820, phoneH: 1730, fontSize: 72, subSize: 32, topPad: 70, gap: 70, radius: 66, screenRadius: 56, notchW: 190, notchH: 38, notchTop: 26, framePad: 14 },
};

function generateHTML(screenshot, imageDataUri, size) {
  const [g1, g2, g3] = screenshot.gradient;
  const s = size;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${s.width}px;
    height: ${s.height}px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
  }

  .container {
    width: ${s.width}px;
    height: ${s.height}px;
    background: linear-gradient(165deg, ${g1} 0%, ${g2} 50%, ${g3} 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
  }

  /* Decorative circles */
  .container::before {
    content: '';
    position: absolute;
    top: -120px;
    right: -120px;
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: rgba(255,255,255,0.08);
  }
  .container::after {
    content: '';
    position: absolute;
    bottom: 200px;
    left: -150px;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: rgba(255,255,255,0.06);
  }

  .text-area {
    padding: ${s.topPad}px 60px 10px;
    text-align: center;
    z-index: 2;
  }

  .headline {
    font-size: ${s.fontSize}px;
    font-weight: 800;
    color: #fff;
    line-height: 1.15;
    white-space: pre-line;
    text-shadow: 0 2px 20px rgba(0,0,0,0.15);
    letter-spacing: -1px;
  }

  .subtitle {
    font-size: ${s.subSize}px;
    font-weight: 400;
    color: rgba(255,255,255,0.9);
    line-height: 1.45;
    margin-top: 16px;
    white-space: pre-line;
  }

  .phone-wrapper {
    display: flex;
    justify-content: center;
    z-index: 2;
    width: 100%;
    margin-top: ${s.gap}px;
  }

  .phone-frame {
    width: ${s.phoneW}px;
    height: ${s.phoneH}px;
    background: #1a1a1a;
    border-radius: ${s.radius}px;
    padding: ${s.framePad}px;
    box-shadow:
      0 30px 80px rgba(0,0,0,0.35),
      0 10px 30px rgba(0,0,0,0.2),
      inset 0 1px 0 rgba(255,255,255,0.1);
    position: relative;
    flex-shrink: 0;
  }

  /* Dynamic island notch */
  .phone-frame::before {
    content: '';
    position: absolute;
    top: ${s.notchTop}px;
    left: 50%;
    transform: translateX(-50%);
    width: ${s.notchW}px;
    height: ${s.notchH}px;
    background: #1a1a1a;
    border-radius: 20px;
    z-index: 10;
  }

  .phone-screen {
    width: 100%;
    height: 100%;
    border-radius: ${s.screenRadius}px;
    overflow: hidden;
    background: #fff;
  }

  .phone-screen img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    display: block;
  }
</style>
</head>
<body>
<div class="container">
  <div class="text-area">
    <div class="headline">${screenshot.headline}</div>
    <div class="subtitle">${screenshot.subtitle}</div>
  </div>
  <div class="phone-wrapper">
    <div class="phone-frame">
      <div class="phone-screen">
        <img src="${imageDataUri}" />
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const [sizeName, size] of Object.entries(SIZES)) {
    const dir = sizeName === 'phone' ? __dirname : path.join(__dirname, sizeName);
    if (sizeName !== 'phone') fs.mkdirSync(dir, { recursive: true });

    console.log(`\n=== ${sizeName} (${size.width}x${size.height}) ===`);

    for (const screenshot of SCREENSHOTS) {
      console.log(`  Generating ${screenshot.id}...`);

      const sourcePath = path.join(__dirname, screenshot.source);
      const imageBuffer = fs.readFileSync(sourcePath);
      const imageDataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      const page = await browser.newPage();
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });

      const html = generateHTML(screenshot, imageDataUri, size);
      await page.setContent(html, { waitUntil: 'networkidle0' });

      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 800));

      const outputPath = path.join(dir, `${screenshot.id}.png`);
      await page.screenshot({ path: outputPath, type: 'png' });
      console.log(`    -> ${outputPath}`);

      await page.close();
    }
  }

  await browser.close();
  console.log('\nDone! Generated all screenshots.');
}

main().catch(console.error);
