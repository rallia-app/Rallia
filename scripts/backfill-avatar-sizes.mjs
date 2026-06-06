#!/usr/bin/env node
/**
 * Backfill: shrink existing profile-pictures to 320px wide.
 *
 * The app now stores avatars at 320px and serves them raw (no Supabase image
 * transformation). Avatars uploaded before that change are still ~800px, so
 * serving them raw ships an oversized file. This one-off re-encodes every
 * existing avatar to 320px JPEG q85 in place, overwriting the same object path.
 *
 * Counts toward NOTHING on the image-transformation bill — it reads/writes
 * plain storage objects with sharp locally.
 *
 * SAFETY: dry-run by default. It only mutates storage when you pass --apply.
 * It targets whichever project SUPABASE_URL points at — print check the host.
 *
 * Required env (process.env first, then apps/web/.env fallback):
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY   — needs full storage access across all users
 *
 * Run:
 *   node scripts/backfill-avatar-sizes.mjs              # dry-run, lists work
 *   node scripts/backfill-avatar-sizes.mjs --apply      # actually re-encodes
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUCKET = 'profile-pictures';
const TARGET_WIDTH = 320;
const JPEG_QUALITY = 85;
const CACHE_CONTROL = '604800'; // 7 days, matches uploadImage
const CONCURRENCY = 6;
const APPLY = process.argv.includes('--apply');

function getArg(name) {
  const i = process.argv.findIndex(a => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  const arg = process.argv[i];
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[i + 1] ?? null;
}

// --apply requires naming the target project ref; the script aborts if the
// resolved SUPABASE_URL host doesn't match. Makes the destructive target
// explicit on the command line instead of trusting whatever env resolves to.
const EXPECTED_REF = getArg('--project');

// Optional: restrict the backfill to a single user's avatars (folder or
// root-level "{userId}-*" naming). Used for a cautious one-user prod trial.
const TARGET_USER = getArg('--user');

// Optional explicit env file (e.g. a gitignored apps/web/.env.production.local)
// so prod creds never need to appear in argv/chat.
const ENV_FILE = getArg('--env-file');

// --- env loading (process.env first, then --env-file, then apps/web/.env*) ---
function parseEnvFile(absPath, into) {
  let envText = '';
  try {
    envText = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  for (const line of envText.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq === -1) continue;
    into[l.slice(0, eq)] = l.slice(eq + 1);
  }
}

function loadEnv() {
  const fromProc = {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromProc.url && fromProc.key) return fromProc;

  const env = {};
  if (ENV_FILE) {
    // Explicit file wins and is the only source (keeps prod isolated from staging .env.local).
    parseEnvFile(ENV_FILE, env);
  } else {
    // Read apps/web/.env then .env.local (.local overrides, Next.js convention).
    parseEnvFile(join(__dirname, '..', 'apps', 'web', '.env'), env);
    parseEnvFile(join(__dirname, '..', 'apps', 'web', '.env.local'), env);
  }
  return {
    url: fromProc.url || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    key: fromProc.key || env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

const { url: SUPABASE_URL, key: SERVICE_KEY } = loadEnv();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in env or apps/web/.env).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- list every object under the bucket (recurses folders) ----------------
async function listAll(prefix = '') {
  const out = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders have no id/metadata; files have metadata with a size.
      if (entry.id === null || entry.metadata == null) {
        out.push(...(await listAll(path)));
      } else {
        out.push({ path, size: entry.metadata.size ?? 0 });
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function processOne(obj) {
  const ext = obj.path.split('.').pop()?.toLowerCase() ?? '';
  if (!['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) {
    return { path: obj.path, status: 'skipped (not an image)' };
  }

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(obj.path);
  if (dlErr) return { path: obj.path, status: `error (download: ${dlErr.message})` };

  const input = Buffer.from(await blob.arrayBuffer());
  const meta = await sharp(input).metadata();
  if ((meta.width ?? 0) <= TARGET_WIDTH) {
    return { path: obj.path, status: `skipped (already ${meta.width}px)`, before: input.length };
  }

  const output = await sharp(input)
    .rotate() // respect EXIF orientation before stripping metadata
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  if (!APPLY) {
    return {
      path: obj.path,
      status: `would shrink ${meta.width}px ${(input.length / 1024).toFixed(0)}KB -> ${(
        output.length / 1024
      ).toFixed(0)}KB`,
      before: input.length,
      after: output.length,
    };
  }

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(obj.path, output, {
    contentType: 'image/jpeg',
    cacheControl: CACHE_CONTROL,
    upsert: true,
  });
  if (upErr) return { path: obj.path, status: `error (upload: ${upErr.message})` };

  return {
    path: obj.path,
    status: `shrunk ${meta.width}px ${(input.length / 1024).toFixed(0)}KB -> ${(
      output.length / 1024
    ).toFixed(0)}KB`,
    before: input.length,
    after: output.length,
  };
}

async function main() {
  const host = new URL(SUPABASE_URL).host;
  console.log(`Target project: ${host}`);
  console.log(`Bucket: ${BUCKET}  Target width: ${TARGET_WIDTH}px`);

  if (APPLY) {
    if (!EXPECTED_REF) {
      console.error(
        '\nRefusing to write: --apply requires --project <ref> naming the target project,\n' +
          `e.g. --project ${host.split('.')[0]}`
      );
      process.exit(1);
    }
    if (!host.startsWith(`${EXPECTED_REF}.`)) {
      console.error(
        `\nRefusing to write: --project "${EXPECTED_REF}" does not match resolved host "${host}".`
      );
      process.exit(1);
    }
    console.log(`Confirmed target ref: ${EXPECTED_REF}`);
  }

  console.log(APPLY ? '*** APPLY MODE — objects will be overwritten ***' : 'DRY RUN (no writes)');
  if (TARGET_USER) console.log(`Scope: single user ${TARGET_USER}`);
  console.log('Listing objects…');

  let objects = await listAll();
  if (TARGET_USER) {
    const total = objects.length;
    objects = objects.filter(
      o => o.path.startsWith(`${TARGET_USER}/`) || o.path.startsWith(`${TARGET_USER}-`)
    );
    console.log(`Found ${total} objects; ${objects.length} match user ${TARGET_USER}.`);
    if (objects.length === 0) {
      console.error(`No avatars found for user ${TARGET_USER}. Nothing to do.`);
      process.exit(objects.length === 0 ? 0 : 1);
    }
    console.log('');
  } else {
    console.log(`Found ${objects.length} objects.\n`);
  }

  let processed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const errors = [];

  for (let i = 0; i < objects.length; i += CONCURRENCY) {
    const batch = objects.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(processOne));
    for (const r of results) {
      console.log(`  ${r.path}: ${r.status}`);
      if (r.status.startsWith('error')) errors.push(r);
      if (r.before) bytesBefore += r.before;
      if (r.after) bytesAfter += r.after;
      if (r.status.startsWith('would shrink') || r.status.startsWith('shrunk')) processed += 1;
    }
  }

  console.log('\n--- summary ---');
  console.log(`${APPLY ? 'Re-encoded' : 'Would re-encode'}: ${processed} avatar(s)`);
  if (bytesBefore && bytesAfter) {
    console.log(
      `Size on processed: ${(bytesBefore / 1024 / 1024).toFixed(1)}MB -> ${(
        bytesAfter / 1024 / 1024
      ).toFixed(1)}MB`
    );
  }
  if (errors.length) console.log(`Errors: ${errors.length} (see log above)`);
  if (!APPLY) console.log('\nRe-run with --apply to perform the writes.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
