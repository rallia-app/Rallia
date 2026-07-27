#!/usr/bin/env node
// Generates the 9 Serie 1 tournament banners (3 zones x 3 categories).
//
// Colours come from @rallia/design-system, never hand-picked hex. Node strips
// the TS types on import, so the tokens are the same objects the apps use.
//
// Layout is dictated by what the app paints over the image. TournamentBanner
// renders 2.4:1 with resizeMode="cover", so a 1080x450 source is never cropped,
// but two regions are spoken for:
//   * y 30-105, both top corners: status pill and points badge
//   * y 230+ : the scrim carrying the tournament name and the date/city line
// So the artwork's own text sits in y 90-265, left-aligned clear of the badges,
// and the bottom third is deliberately texture only.
//
// The banner does NOT repeat "Série 1" or the tournament name: the scrim already
// renders "Série 1 Montréal · Intermédiaire" right underneath. It carries what
// the name cannot — the zone at a glance, the municipalities covered (the whole
// point of the split), and the rating band.
//
// Usage: node scripts/tournaments/generate-serie1-banners.mjs [outDir]

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ds = path.resolve(process.cwd(), 'packages/design-system/src/tokens/colors.ts')
const { primary, secondary, accent, base } = await import(ds)

const { default: sharp } = await import(path.resolve(process.cwd(), 'node_modules/sharp/lib/index.js'))

const W = 1080
const H = 450
const SCALE = 2
const PAD = 72

// Zones share the brand teal and differ by depth and motif rather than hue:
// inventing a blue and a purple would put two thirds of the set outside the
// design system. The motif is the real tell — rings for the island, chevrons
// pointing the way you'd drive.
const ZONES = [
  {
    key: 'montreal',
    label: 'MONTRÉAL',
    towns: "Île de Montréal · Verdun · LaSalle · Lachine · Ouest-de-l'Île",
    from: primary[950],
    to: primary[800],
    motif: 'rings',
  },
  {
    key: 'rive-nord',
    label: 'RIVE-NORD',
    towns: 'Laval · Saint-Eustache · Terrebonne · Repentigny · Blainville',
    from: primary[900],
    to: primary[600],
    motif: 'up',
  },
  {
    key: 'rive-sud',
    label: 'RIVE-SUD',
    towns: 'Longueuil · Brossard · Saint-Hubert · La Prairie · Candiac',
    from: primary[950],
    to: primary[700],
    motif: 'down',
  },
]

const CATEGORIES = [
  { key: 'debutant', label: 'DÉBUTANT', band: '1.5 à 2.5', accent: primary[300] },
  { key: 'intermediaire', label: 'INTERMÉDIAIRE', band: '3.0 à 3.5', accent: secondary[500] },
  { key: 'avance', label: 'AVANCÉ', band: '4.0 et +', accent: accent[400] },
]

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Rough advance-width estimate so the pill hugs its label without measuring.
const textWidth = (s, size, tracking = 0) => s.length * size * 0.62 + s.length * tracking

// Anchored off the right edge so the motif bleeds out of frame instead of
// sitting in the middle competing with the wordmark.
function motif(kind, tint) {
  if (kind === 'rings') {
    return [92, 176, 268, 368, 476]
      .map(
        (r, i) =>
          `<circle cx="880" cy="240" r="${r}" fill="none" stroke="${tint}" stroke-width="${i === 0 ? 5 : 3}" stroke-opacity="${(0.5 * 0.72 ** i).toFixed(3)}"/>`
      )
      // Near-opaque: at 0.55 the coral accent muddies to brown over the teal.
      .concat(`<circle cx="880" cy="240" r="26" fill="${tint}" fill-opacity="0.92"/>`)
      .join('\n    ')
  }
  // Carets stacked vertically, pointing the way you'd drive out of town: up for
  // the north shore, down for the south. They must be asymmetric about their own
  // axis, otherwise 'up' and 'down' render as the same shape and two thirds of
  // the set becomes indistinguishable.
  const up = kind === 'up'
  const x0 = 636
  const x1 = 1104
  return [0, 1, 2, 3, 4]
    .map((i) => {
      const y = 108 + i * 58
      const peak = up ? y - 46 : y + 46
      const fade = up ? i : 4 - i
      return `<path d="M ${x0} ${y} L ${(x0 + x1) / 2} ${peak} L ${x1} ${y}" fill="none" stroke="${tint}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="${(0.55 * 0.72 ** fade).toFixed(3)}"/>`
    })
    .join('\n    ')
}

function svg(zone, category) {
  const pillLabel = `${category.label} · ${category.band}`
  const pillFont = 22
  const pillTrack = 1.5
  const pillW = Math.round(textWidth(pillLabel, pillFont, pillTrack) + 50)
  const pillH = 42
  // Below y=105: above that the app's status pill sits in this exact corner.
  const pillY = 112

  const zoneFont = zone.label.length > 8 ? 84 : 90
  const zoneTrack = zone.label.length > 8 ? 2 : 4

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.9">
      <stop offset="0%"   stop-color="${zone.from}"/>
      <stop offset="100%" stop-color="${zone.to}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${primary[950]}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${primary[950]}" stop-opacity="0.55"/>
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
    ${motif(zone.motif, category.accent)}
  </g>

  <!-- Weights the lower third so the app's scrim lands on tone, not on a seam -->
  <rect y="210" width="${W}" height="${H - 210}" fill="url(#floor)"/>

  <!-- Category first: it is the one thing the truncated name may lose -->
  <rect x="${PAD}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${category.accent}"/>
  <text x="${PAD + pillW / 2}" y="${pillY + 30}" text-anchor="middle" font-family="${FONT}"
        font-size="${pillFont}" font-weight="800" letter-spacing="${pillTrack}"
        fill="${primary[950]}">${esc(pillLabel)}</text>

  <text x="${PAD}" y="243" font-family="${FONT}" font-size="${zoneFont}" font-weight="800"
        letter-spacing="${zoneTrack}" fill="${base.white}" filter="url(#lift)">${esc(zone.label)}</text>

  <rect x="${PAD}" y="264" width="80" height="5" rx="2.5" fill="${category.accent}"/>

  <text x="${PAD}" y="301" font-family="${FONT}" font-size="19" font-weight="500"
        letter-spacing="0.4" fill="${base.white}" fill-opacity="0.82">${esc(zone.towns)}</text>

  <rect y="${H - 5}" width="${W}" height="5" fill="${category.accent}"/>
</svg>`
}

const outDir = path.resolve(process.argv[2] ?? 'scratchpad/serie1-banners')
await mkdir(outDir, { recursive: true })

for (const zone of ZONES) {
  for (const category of CATEGORIES) {
    const markup = svg(zone, category)
    const name = `serie1-${zone.key}-${category.key}-v2`

    // Render at 2x then downscale: librsvg hints text at the raster size, and
    // the extra pass keeps the wordmark edges clean at 1080 wide.
    const buf = await sharp(Buffer.from(markup), { density: 72 * SCALE })
      .resize(W * SCALE, H * SCALE)
      .png()
      .toBuffer()

    await sharp(buf).resize(W, H).webp({ quality: 92 }).toFile(path.join(outDir, `${name}.webp`))
    await writeFile(path.join(outDir, `${name}.svg`), markup)
  }
}

console.log(`9 banners written to ${outDir}`)
