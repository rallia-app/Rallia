#!/usr/bin/env node
// Generates the 3 Série 2 tournament banners (tennis, one per category).
//
// LINEAGE. The live Série 1 banners are the hand-designed "v3" set; no source
// file for them exists in this repo, only the shipped webp in each project's
// tournament-logos bucket. This script rebuilds that look programmatically
// from @rallia/design-system tokens: teal gradient, diagonal hairlines, court
// motif bleeding off the right edge, skewed category pill, heavy italic
// wordmark, Rallia mark bottom-right, accent rule along the bottom. Close, not
// pixel-identical. If the designer files turn up, prefer those.
//
// Colours come from the design system, never hand-picked hex.
//
// LAYOUT is dictated by what the app paints over the image. TournamentBanner
// renders 2.4:1 with resizeMode="cover", so 1080x450 is never cropped, but two
// regions are spoken for:
//   * y 30-105, both top corners: status pill and points badge
//   * y 230+ : the scrim carrying the tournament name and the date/city line
// The artwork's own text therefore sits in y 110-340, left-aligned clear of
// the badges. This is the mistake the v3 retouch had to patch out of the
// pixels, so it is worth respecting here.
//
// The banner does NOT repeat "Série 2" or the tournament name: the scrim
// already renders "Série 2 Montréal · Tennis · Intermédiaire" underneath. It
// carries what the name cannot, which for Série 2 is the format and the money.
//
// Usage: node scripts/tournaments/generate-serie2-banners.mjs [outDir]

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ds = path.resolve(process.cwd(), 'packages/design-system/src/tokens/colors.ts')
const { primary, secondary, accent, base } = await import(ds)

const { default: sharp } = await import(path.resolve(process.cwd(), 'node_modules/sharp/lib/index.js'))

const W = 1080
const H = 450
const SCALE = 2
const PAD = 72

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

// Same category accents the v2 generator used and the v3 artwork kept: teal
// for Débutant, coral for Intermédiaire, gold for Avancé.
const CATEGORIES = [
  { key: 'debutant', label: 'DÉBUTANT', band: '1.0 à 2.5', tint: primary[300] },
  { key: 'intermediaire', label: 'INTERMÉDIAIRE', band: '3.0 à 3.5', tint: secondary[500] },
  { key: 'avance', label: 'AVANCÉ', band: '4.0 et +', tint: accent[400] },
]

// What the scrim underneath cannot say.
const HEADLINE = 'ROUND ROBIN'
const SUBLINE = 'Île de Montréal · 8 poules de 4 · 250 $ de bourse'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Rough advance-width estimate so the pill hugs its label without measuring.
const textWidth = (s, size, tracking = 0) => s.length * size * 0.62 + s.length * tracking

// The Rallia mark is an SVG with a document-scoped <style> block using generic
// cls-N names, which would collide with anything else in the same document.
// Rasterise it first and embed the PNG, so nothing leaks between the two.
const logoSvg = path.resolve(process.cwd(), 'apps/mobile/assets/images/logo-light.svg')
const LOGO_W = 148
const LOGO_H = Math.round(LOGO_W * (518.32 / 1330.65))
const logoPng = await sharp(await readFile(logoSvg), { density: 600 })
  .resize(LOGO_W * SCALE, LOGO_H * SCALE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
const LOGO_HREF = `data:image/png;base64,${logoPng.toString('base64')}`

// Hairlines at 45 degrees across the whole canvas. Barely visible on their own;
// they are what stops the gradient reading as flat vector fill.
const hairlines = () => {
  const out = []
  for (let x = -H; x < W + H; x += 15) {
    out.push(
      `<line x1="${x}" y1="0" x2="${x + H}" y2="${H}" stroke="${base.white}" stroke-opacity="0.028" stroke-width="1.5"/>`
    )
  }
  return out.join('\n    ')
}

// A court seen at an angle, bleeding off the right edge, plus the concentric
// rings from the Série 1 island motif. Anchored right so it never competes
// with the wordmark.
const courtMotif = (tint) => {
  const rings = [214, 312, 418]
    .map(
      (r, i) =>
        `<circle cx="905" cy="238" r="${r}" fill="none" stroke="${tint}" stroke-width="2" stroke-opacity="${(0.2 * 0.74 ** i).toFixed(3)}"/>`
    )
    .join('\n    ')

  // Stadium outline + service circle + baseline, tilted so it reads as a court
  // in perspective and bleeds off the top edge.
  return `${rings}
    <g transform="rotate(-8 905 200)" fill="none" stroke="${tint}" stroke-opacity="0.42" stroke-width="3.5">
      <rect x="800" y="-26" width="222" height="336" rx="107"/>
      <line x1="812" y1="142" x2="1010" y2="142"/>
      <circle cx="911" cy="142" r="86"/>
    </g>`
}

function svg(category) {
  const pillLabel = `${category.label} · ${category.band}`
  const pillFont = 22
  const pillTrack = 1.5
  const pillW = Math.round(textWidth(pillLabel, pillFont, pillTrack) + 52)
  const pillH = 44
  // Below y=105: above that the app's status pill sits in this exact corner.
  const pillY = 128

  // The v3 wordmark is a true italic. librsvg synthesises obliques
  // inconsistently across font stacks, so slant the geometry instead.
  // skewX(-a) maps x' = x - tan(a)*y, which in SVG's y-down space leans the
  // tops right: a forward italic. It also drags everything left by tan(a)*y,
  // and that shift grows with depth, so each element compensates at the y its
  // own left edge is deepest (a text run at its baseline, a rect at its
  // bottom). Without this the wordmark walks off the left edge.
  const SKEW_DEG = 12
  const TAN = Math.tan((SKEW_DEG * Math.PI) / 180)
  const slant = `skewX(${-SKEW_DEG})`
  const unslant = (y) => TAN * y

  const HEAD_Y = 274

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.85">
      <stop offset="0%"   stop-color="${primary[950]}"/>
      <stop offset="55%"  stop-color="${primary[900]}"/>
      <stop offset="100%" stop-color="${primary[800]}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${primary[950]}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${primary[950]}" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="leftwash" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${primary[950]}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${primary[950]}" stop-opacity="0"/>
    </linearGradient>
    <filter id="lift" x="-15%" y="-40%" width="130%" height="190%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="9"/>
      <feOffset dy="6" result="o"/>
      <feFlood flood-color="${primary[950]}" flood-opacity="0.55"/>
      <feComposite in2="o" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <g>
    ${hairlines()}
  </g>

  <g>
    ${courtMotif(category.tint)}
  </g>

  <!-- Keeps the motif off the wordmark without dimming the whole frame -->
  <rect width="620" height="${H}" fill="url(#leftwash)"/>

  <!-- Weights the lower third so the app's scrim lands on tone, not on a seam -->
  <rect y="210" width="${W}" height="${H - 210}" fill="url(#floor)"/>

  <!-- Category first: it is the one thing the truncated name may lose -->
  <g transform="${slant}">
    <rect x="${(PAD + 6 + unslant(pillY + pillH)).toFixed(1)}" y="${pillY}" width="${pillW}" height="${pillH}" rx="8" fill="${category.tint}"/>
    <text x="${(PAD + 6 + unslant(pillY + pillH) + pillW / 2).toFixed(1)}" y="${pillY + 30}" text-anchor="middle" font-family="${FONT}"
          font-size="${pillFont}" font-weight="800" letter-spacing="${pillTrack}"
          fill="${primary[950]}">${esc(pillLabel)}</text>
  </g>

  <g transform="${slant}">
    <text x="${(PAD + unslant(HEAD_Y)).toFixed(1)}" y="${HEAD_Y}" font-family="${FONT}" font-size="86" font-weight="800"
          letter-spacing="1" fill="${base.white}" filter="url(#lift)">${esc(HEADLINE)}</text>
  </g>

  <text x="${PAD}" y="326" font-family="${FONT}" font-size="19" font-weight="500"
        letter-spacing="0.4" fill="${base.white}" fill-opacity="0.82">${esc(SUBLINE)}</text>

  <image href="${LOGO_HREF}" x="${W - 30 - LOGO_W}" y="${H - 32 - LOGO_H}" width="${LOGO_W}" height="${LOGO_H}"/>

  <rect y="${H - 6}" width="${W}" height="6" fill="${category.tint}"/>
</svg>`
}

const outDir = path.resolve(process.argv[2] ?? 'scratchpad/serie2-banners')
await mkdir(outDir, { recursive: true })

for (const category of CATEGORIES) {
  const markup = svg(category)
  const name = `serie2-montreal-tennis-${category.key}-v1`

  // Render at 2x then downscale: librsvg hints text at the raster size, and
  // the extra pass keeps the wordmark edges clean at 1080 wide.
  const buf = await sharp(Buffer.from(markup), { density: 72 * SCALE })
    .resize(W * SCALE, H * SCALE)
    .png()
    .toBuffer()

  await sharp(buf).resize(W, H).webp({ quality: 92 }).toFile(path.join(outDir, `${name}.webp`))
  await writeFile(path.join(outDir, `${name}.svg`), markup)
}

console.log(`${CATEGORIES.length} banners written to ${outDir}`)
