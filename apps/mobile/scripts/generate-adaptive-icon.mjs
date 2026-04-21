#!/usr/bin/env node
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, '..', 'assets');
const sourcePath = resolve(assetsDir, 'icon.png');
const outputPath = resolve(assetsDir, 'adaptive-icon.png');

const CANVAS = 1024;
const SCALE = 0.66;
const LOGO = Math.round(CANVAS * SCALE);
const OFFSET = Math.round((CANVAS - LOGO) / 2);

const resizedLogo = await sharp(sourcePath)
  .resize(LOGO, LOGO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: resizedLogo, left: OFFSET, top: OFFSET }])
  .png()
  .toFile(outputPath);

console.log(`Wrote ${outputPath} (${CANVAS}x${CANVAS}, logo ${LOGO}x${LOGO} centered)`);
