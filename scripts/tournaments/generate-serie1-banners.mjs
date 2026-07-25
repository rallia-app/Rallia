#!/usr/bin/env node
// Generates the 9 Serie 1 tournament banners (3 zones x 3 categories).
//
// Layout is driven by where the app covers the image, not by where it crops it.
// TournamentBanner renders 2.4:1 with resizeMode="cover", so a 1080x450 source
// is never cropped. What it *is* covered by: status/points badges in the top
// corners (~y 30-105) and a bottom scrim carrying the name and date (from ~y 230
// on the detail hero). Everything meaningful therefore lives in y 60-225, and
// the top band only uses the horizontal centre, which the badges leave free.
//
// Usage: node scripts/tournaments/generate-serie1-banners.mjs [outDir]

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require(path.resolve(process.cwd(), 'node_modules/sharp'))

const W = 1080
const H = 450
const SCALE = 2

const ZONES = [
  {
    key: 'montreal',
    label: 'MONTRÉAL',
    towns: "Île de Montréal · Ouest-de-l'Île · Verdun · LaSalle · Lachine",
    accent: '#2dd4bf',
    glow: '#0d9488',
  },
  {
    key: 'rive-nord',
    label: 'RIVE-NORD',
    towns: 'Laval · Saint-Eustache · Terrebonne · Repentigny · Blainville',
    accent: '#60a5fa',
    glow: '#2563eb',
  },
  {
    key: 'rive-sud',
    label: 'RIVE-SUD',
    towns: 'Longueuil · Brossard · Saint-Hubert · La Prairie · Candiac',
    accent: '#c084fc',
    glow: '#7c3aed',
  },
]

const CATEGORIES = [
  { key: 'debutant', label: 'DÉBUTANT', band: '1.5 à 2.5', accent: '#5eead4' },
  { key: 'intermediaire', label: 'INTERMÉDIAIRE', band: '3.0 à 3.5', accent: '#ed6a6d' },
  { key: 'avance', label: 'AVANCÉ', band: '4.0 et +', accent: '#fbbf24' },
]

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Rough advance-width estimate so the pill can be sized without measuring text.
const textWidth = (s, size, tracking = 0) => s.length * size * 0.62 + s.length * tracking

function svg(zone, category) {
  const pillLabel = `${category.label} · ${category.band}`
  const pillFont = 23
  const pillTracking = 1.6
  const pillW = Math.round(textWidth(pillLabel, pillFont, pillTracking) + 56)
  const pillX = Math.round((W - pillW) / 2)

  // The wordmark is the one thing a player must read while scrolling, so it
  // gets the largest size that still clears the bottom scrim.
  const zoneFont = zone.label.length > 8 ? 82 : 92
  const zoneTracking = zone.label.length > 8 ? 5 : 7

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#021f1c"/>
      <stop offset="55%"  stop-color="#04332e"/>
      <stop offset="100%" stop-color="#065f54"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.46" r="0.62">
      <stop offset="0%"   stop-color="${zone.glow}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${zone.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${zone.accent}" stop-opacity="0"/>
      <stop offset="50%"  stop-color="${zone.accent}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${zone.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Serie 1 poster language: concentric arcs bottom-left, bracket ticks right -->
  <g fill="none" stroke="${zone.accent}" stroke-opacity="0.16">
    <circle cx="60" cy="430" r="150" stroke-width="2"/>
    <circle cx="60" cy="430" r="230" stroke-width="2"/>
    <circle cx="60" cy="430" r="310" stroke-width="2"/>
  </g>
  <g stroke="${category.accent}" stroke-opacity="0.30" stroke-width="3" fill="none">
    <path d="M980 150 h40 v55 h40"/>
    <path d="M980 260 h40 v-55"/>
  </g>

  <!-- Zone stripe: a second, non-brand colour axis so two cards never read alike -->
  <rect x="0" y="0" width="9" height="${H}" fill="${zone.accent}"/>

  <text x="${W / 2}" y="72" text-anchor="middle" font-family="${FONT}"
        font-size="19" font-weight="700" letter-spacing="7"
        fill="#5eead4" fill-opacity="0.85">SÉRIE 1</text>

  <rect x="${pillX}" y="96" width="${pillW}" height="42" rx="21"
        fill="${category.accent}" fill-opacity="0.16"
        stroke="${category.accent}" stroke-opacity="0.75" stroke-width="2"/>
  <text x="${W / 2}" y="124" text-anchor="middle" font-family="${FONT}"
        font-size="${pillFont}" font-weight="700" letter-spacing="${pillTracking}"
        fill="${category.accent}">${esc(pillLabel)}</text>

  <text x="${W / 2}" y="221" text-anchor="middle" font-family="${FONT}"
        font-size="${zoneFont}" font-weight="800" letter-spacing="${zoneTracking}"
        fill="#ffffff">${esc(zone.label)}</text>

  <rect x="${W / 2 - 190}" y="238" width="380" height="3" fill="url(#rule)"/>

  <text x="${W / 2}" y="268" text-anchor="middle" font-family="${FONT}"
        font-size="18" font-weight="500" letter-spacing="0.6"
        fill="#ffffff" fill-opacity="0.78">${esc(zone.towns)}</text>
</svg>`
}

const outDir = path.resolve(process.argv[2] ?? 'scratchpad/serie1-banners')
await mkdir(outDir, { recursive: true })

for (const zone of ZONES) {
  for (const category of CATEGORIES) {
    const markup = svg(zone, category)
    const name = `serie1-${zone.key}-${category.key}-v1`

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
