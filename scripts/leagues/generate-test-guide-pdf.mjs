#!/usr/bin/env node
/**
 * Regenerates Guide_de_test_des_ligues.pdf from scripts/leagues/test-guide.html
 *
 * Usage: npm run docs:league-test-guide
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'test-guide.html');
const PDF_PATH = path.join(__dirname, '..', '..', 'Guide_de_test_des_ligues.pdf');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function resolveChrome() {
  for (const candidate of CHROME_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Chrome not found. Tried: ${CHROME_PATHS.join(', ')}`);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${HTML_PATH}`, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: PDF_PATH,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    console.log(`Wrote ${PDF_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
