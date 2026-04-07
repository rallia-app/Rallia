#!/usr/bin/env node
/**
 * Generates clean phone mockups for pitch decks.
 * No headline, no gradient — just the phone in a teal border on white.
 *
 * Usage: node scripts/generate-pitch-mockups.mjs
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, '..', 'assets', 'store', 'screenshots', 'sources', 'fr-light', 'iphone');
const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'store', 'screenshots', 'generated', 'pitch');

const GLOW = '#0d9488';
const GLOW_LIGHT = '#5eead4';
const GLOW_DARK = '#0f766e';

const WIDTH = 1080;
const HEIGHT = 1920;
const PHONE_W = 740;
const PHONE_H = 1600;
const RADIUS = 52;
const BEZEL = 8;

function generateHTML(imageDataUri) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .phone-border {
    width: ${PHONE_W}px;
    height: ${PHONE_H}px;
    border-radius: ${Math.round(RADIUS * 1.6)}px;
    background: linear-gradient(
      165deg,
      ${GLOW_LIGHT} 0%,
      ${GLOW} 30%,
      ${GLOW_DARK} 60%,
      ${GLOW} 75%,
      ${GLOW_LIGHT} 100%
    );
    padding: ${BEZEL}px;
    box-shadow:
      0 0 12px 2px ${GLOW}60,
      0 0 30px 4px ${GLOW}35,
      0 0 60px 8px ${GLOW}18,
      0 20px 40px -8px rgba(0, 0, 0, 0.10);
  }

  .phone-frame {
    width: 100%;
    height: 100%;
    border-radius: ${Math.round(RADIUS * 1.3)}px;
    overflow: hidden;
    background: #fff;
    position: relative;
  }

  .phone-frame img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
  }

  .phone-frame::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      125deg,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0.05) 25%,
      transparent 50%,
      transparent 100%
    );
    pointer-events: none;
    border-radius: ${Math.round(RADIUS * 1.3)}px;
  }
</style>
</head>
<body>
  <div class="phone-border">
    <div class="phone-frame">
      <img src="${imageDataUri}" />
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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(INPUT_DIR).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();

  for (const file of files) {
    console.log(`  Generating ${file}...`);
    const imageBuffer = fs.readFileSync(path.join(INPUT_DIR, file));
    const imageDataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(generateHTML(imageDataUri), { waitUntil: 'load', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));

    const name = path.basename(file, path.extname(file));
    const outputPath = path.join(OUTPUT_DIR, `${name}-mockup.png`);
    await page.screenshot({ path: outputPath, type: 'png', omitBackground: true });
    console.log(`    -> ${outputPath}`);
    await page.close();
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
