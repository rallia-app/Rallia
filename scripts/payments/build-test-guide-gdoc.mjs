#!/usr/bin/env node
/**
 * Emits a Google-Docs-friendly HTML rendering of the payments test protocol,
 * from the same source as the PDFs (scripts/payments/test-guide.html).
 *
 * Drive converts uploaded text/html into a Doc, but its importer ignores
 * <style> blocks and drops borders on block elements. So the two things that
 * carry meaning in this document have to be re-expressed inline:
 *
 *   - the coloured callouts (expected result vs warning vs stop) become
 *     single-cell tables, the one construct whose background colour Docs keeps
 *   - the pills and fixture names become styled inline spans
 *
 * Usage: node scripts/payments/build-test-guide-gdoc.mjs > out.html
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'test-guide.html');

/** Callout paragraph classes -> the colours they carry in the PDF. */
const CALLOUTS = {
  lifecycle: { bg: '#f0fdfa', border: '#99f6e4', color: '#0f766e' },
  warn: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
  stop: { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' },
  check: { bg: '#f8fafc', border: '#cbd5e1', color: '#334155' },
};

/** Pill variants. Longest class string first so 'pill live' wins over 'pill'. */
const PILLS = {
  'pill live': { bg: '#dcfce7', color: '#15803d' },
  'pill sim': { bg: '#f3f4f6', color: '#4b5563' },
  'pill new': { bg: '#eef2ff', color: '#4338ca' },
  pill: { bg: '#ecfdf5', color: '#0f766e' },
};

function build(source) {
  let html = source.match(/<body>([\s\S]*)<\/body>/)[1];

  // Inline spans first: the callout wrapper below copies its inner HTML
  // verbatim, so these have to already be resolved.
  html = html.replace(
    /<span class="fixture">([\s\S]*?)<\/span>/g,
    (_, inner) =>
      `<span style="font-family:'Courier New',monospace;background-color:#f3f4f6;">${inner}</span>`
  );

  // No padding characters around the label: the PDF's pill padding is CSS, and
  // reproducing it with &nbsp; doubles the space the source already has and
  // strands one before the following punctuation ("affiche  Action requise .").
  html = html.replace(/<span class="(pill(?: [a-z]+)?)">([\s\S]*?)<\/span>/g, (_, cls, inner) => {
    const p = PILLS[cls] ?? PILLS.pill;
    return `<span style="background-color:${p.bg};color:${p.color};font-weight:bold;">${inner}</span>`;
  });

  // Fixture tables. Done before the callouts so their generated <td>s are not
  // caught by this pass.
  html = html.replace(
    /<table class="fixtures-table">/g,
    '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;">'
  );
  html = html.replace(/<th>/g, '<th style="border:1px solid #d1d5db;background-color:#ecfdf5;">');
  html = html.replace(/<td>/g, '<td style="border:1px solid #d1d5db;">');

  html = html.replace(
    /<h1>([\s\S]*?)<\/h1>/g,
    (_, i) => `<h1 style="color:#111827;">${i}</h1>`
  );
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, i) => `<h2 style="color:#0f766e;">${i}</h2>`);
  html = html.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, i) => `<h3 style="color:#134e4a;">${i}</h3>`);
  html = html.replace(
    /<p class="meta">([\s\S]*?)<\/p>/g,
    (_, i) => `<p style="color:#4b5563;">${i}</p>`
  );
  html = html.replace(/<p class="section-intro">/g, '<p>');

  // Callouts last: a single-cell table is the only block whose background
  // colour survives the Docs importer.
  for (const [cls, c] of Object.entries(CALLOUTS)) {
    const re = new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`, 'g');
    html = html.replace(
      re,
      (_, inner) =>
        `<table style="border-collapse:collapse;width:100%;"><tr>` +
        `<td style="background-color:${c.bg};border:1px solid ${c.border};padding:8px;">` +
        `<p style="margin:0;color:${c.color};">${inner}</p></td></tr></table>`
    );
  }

  // Structural wrappers Docs has no use for.
  html = html.replace(/<\/?section[^>]*>/g, '');

  // The source is pretty-printed: every paragraph is hard-wrapped and indented.
  // A browser collapses that to one space, but the Docs importer is not a
  // browser, and a preserved run shows up as a gap in the middle of a sentence.
  // Collapse everything, then take back the single space that collapsing leaves
  // just inside a block boundary. Spaces between inline tags are left alone --
  // removing those would weld "</span> <strong>" into one word.
  html = html.replace(/\s+/g, ' ');
  const BLOCK = 'p|li|td|th|tr|table|ul|ol|h1|h2|h3';
  html = html.replace(new RegExp(`(<(?:${BLOCK})\\b[^>]*>) `, 'g'), '$1');
  html = html.replace(new RegExp(` (</(?:${BLOCK})>)`, 'g'), '$1');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Protocole de test des paiements</title></head><body>${html}</body></html>`;
}

process.stdout.write(build(fs.readFileSync(HTML_PATH, 'utf8')));
