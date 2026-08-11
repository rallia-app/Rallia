#!/usr/bin/env node
/**
 * Renders the pool_knockout test protocol to PDF from
 * scripts/tournaments/test-guide.html.
 *
 *   docs/Guide_de_test_poules_eliminatoires.pdf   jdl.sonkin@gmail.com
 *
 * Unlike the payments guide there is a single tester, so there is no fixture
 * mirroring: the source is emitted verbatim.
 *
 * Usage: npm run docs:pool-knockout-test-guide
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'test-guide.html');
const OUT_PATH = path.join(__dirname, '..', '..', 'docs', 'Guide_de_test_poules_eliminatoires.pdf');

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
    await page.setContent(fs.readFileSync(HTML_PATH, 'utf8'), { waitUntil: 'networkidle0' });
    await page.pdf({
      path: OUT_PATH,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    console.log(`✅ ${path.relative(process.cwd(), OUT_PATH)}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
