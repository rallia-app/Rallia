#!/usr/bin/env node
/**
 * Regenerates both testers' copies of the payments test protocol from the
 * single source in scripts/payments/test-guide.html.
 *
 *   Guide_de_test_des_paiements.pdf        jdl.sonkin+10@gmail.com (source, verbatim)
 *   Guide_de_test_des_paiements_demo.pdf   demo@rallia.ca (mirrored)
 *
 * The two testers are each other's counterparty: whoever organizes a fixture,
 * the other one pays into it. So the protocol is identical and only the fixture
 * NAMES swap. Rather than keep two documents in sync by hand, the source is
 * written for Jean and MIRROR below maps it onto Alex's fixtures.
 *
 * Applied in ONE pass, longest key first, because two of the substitutions are
 * a genuine swap (the two league names trade places) and a sequential replace
 * would apply the second on top of the first.
 *
 * Usage: npm run docs:payments-test-guide
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'test-guide.html');
const DOCS_DIR = path.join(__dirname, '..', '..', 'docs');

/** Jean's fixture (in the source) -> Alex's equivalent. */
const MIRROR = {
  'jdl.sonkin+10@gmail.com': 'demo@rallia.ca',
  'Jose Caroon': 'Alex Monza',
  "dont Mathis s'occupe de son côté": "dont Jean s'occupe de son côté",

  // Events Jean organizes -> the ones Alex organizes.
  '[PAYUI-JDL] Draft a publier': '[PAYUI] Draft a publier',
  '[PAYUI-JDL] You organize (earnings &amp; cancel)': '[PAYUI] You organize — earnings &amp; cancel',
  '[PAYE2E] 6 - Annulation et remboursement': '[PAYE2E] 8 - Tiers organise',

  // Events Jean pays into -> the ones Alex pays into.
  '[PAYUI-JDL] LIVE register + pay': '[PAYUI] LIVE register + pay',
  '[PAYUI-JDL] Organizer absorbs (pay entry only)': '[PAYUI] Organizer absorbs — pay entry only',
  '[PAYUI-JDL] You are invited (pay to confirm)': '[PAYUI] You are invited — pay to confirm',
  '[PAYUI-JDL] SOLD OUT': '[PAYUI] SOLD OUT',
  '[PAYUI-JDL] Withdraw → full refund': '[PAYUI] Withdraw → full refund',
  '[PAYUI-JDL] Withdraw → 50% refund': '[PAYUI] Withdraw → 50% refund',
  '[PAYUI-JDL] Withdraw → no refund': '[PAYUI] Withdraw → no refund',
  '[PAYUI-JDL] Doubles paid (you + partner)': '[PAYUI] Doubles paid (you + partner)',
  '[PAYUI-JDL] Refund cutoff passed': '[PAYE2E] 5 - Date limite depassee',

  // Leagues. The last two trade places, hence the single-pass replace.
  '[PAYE2E] Ligue payante': '[SEED] Paid League — Draft Season',
  '[SEED] Paid League — Demo Hosts': '[SEED] Paid League - JDL Hosts',
  '[SEED] Paid League - JDL Hosts': '[SEED] Paid League — Demo Hosts',

  // Bare prefix in the intro. Listed last; the regex is sorted by length so the
  // fully-qualified names above always win over this one.
  '[PAYUI-JDL]': '[PAYUI]',
};

const VARIANTS = [
  { file: 'Guide_de_test_des_paiements.pdf', mirror: false },
  { file: 'Guide_de_test_des_paiements_demo.pdf', mirror: true },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mirrorHtml(html) {
  const keys = Object.keys(MIRROR).sort((a, b) => b.length - a.length);
  const re = new RegExp(keys.map(escapeRe).join('|'), 'g');
  const out = html.replace(re, m => MIRROR[m]);

  // The source must be fully translated: any leftover marker means a fixture was
  // renamed without updating MIRROR, which would hand a tester a dead name.
  const leftovers = ['PAYUI-JDL', 'jdl.sonkin', 'Jose Caroon'].filter(t => out.includes(t));
  if (leftovers.length) {
    throw new Error(`MIRROR is out of date, still present after mapping: ${leftovers.join(', ')}`);
  }
  return out;
}

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
    const source = fs.readFileSync(HTML_PATH, 'utf8');

    for (const variant of VARIANTS) {
      const html = variant.mirror ? mirrorHtml(source) : source;
      const pdfPath = path.join(DOCS_DIR, variant.file);

      const page = await browser.newPage();
      // setContent rather than a file:// navigation so the mirrored variant never
      // has to be written to disk as a second HTML that could drift.
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      await page.close();
      console.log(`Wrote ${pdfPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
