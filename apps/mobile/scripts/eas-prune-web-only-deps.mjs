#!/usr/bin/env node
/**
 * Runs as `eas-build-pre-install` on the EAS Build VM before `npm ci`.
 *
 * EAS Build installs the whole monorepo from the repo root, which pulls in
 * apps/web's `sharp` dependency. sharp's prebuilt native binary
 * (`@img/sharp-darwin-arm64` on iOS workers, `@img/sharp-linux-x64` on Android
 * workers) isn't reliably materialized by `npm ci` in workspace lockfiles
 * (npm/cli#4828), so sharp falls back to source build and fails because
 * node-addon-api and libvips aren't available on the worker.
 *
 * Bumping `packageManager` to npm 11 in root package.json fixes this locally
 * but EAS ignores the `packageManager` field for npm — it uses whichever npm
 * ships with the worker's Node.js (still 10.x). So we strip sharp from
 * apps/web's deps and regenerate the lockfile on the VM only. Mobile doesn't
 * use sharp; the repo on disk and Vercel web deploys are unaffected.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webPkgPath = path.join(repoRoot, 'apps', 'web', 'package.json');

const WEB_ONLY_DEPS_TO_PRUNE = ['sharp'];

const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
let mutated = false;

for (const dep of WEB_ONLY_DEPS_TO_PRUNE) {
  if (webPkg.dependencies?.[dep]) {
    delete webPkg.dependencies[dep];
    mutated = true;
    console.log(`[eas-prune] removed ${dep} from apps/web/package.json`);
  }
}

if (!mutated) {
  console.log('[eas-prune] nothing to prune');
  process.exit(0);
}

writeFileSync(webPkgPath, JSON.stringify(webPkg, null, 2) + '\n');

console.log('[eas-prune] regenerating root lockfile');
execSync('npm install --package-lock-only --ignore-scripts', {
  cwd: repoRoot,
  stdio: 'inherit',
});
console.log('[eas-prune] done');
