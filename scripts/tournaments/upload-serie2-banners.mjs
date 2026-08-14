#!/usr/bin/env node
// Uploads the generated Série 2 banners to a project's tournament-logos bucket.
// Storage doesn't travel by migration, so this runs once per environment BEFORE
// create-serie2-paid-tournaments.sql, which writes logo_url.
//
// The service_role key is pulled from the Supabase CLI session rather than an
// env file, so nothing secret lands on disk.
//
// Usage:
//   node scripts/tournaments/generate-serie2-banners.mjs scratchpad/serie2-banners
//   node scripts/tournaments/upload-serie2-banners.mjs <local|staging|prod> scratchpad/serie2-banners
//
// `local` needs the organizer's player id, which differs per machine and per
// db reset, so it is not hardcoded. Pass it in:
//   SERIE2_LOCAL_ORGANIZER=$(psql "$LOCAL_DB_URL" -tAc \
//     "select p.id from player p join profile pr on pr.id=p.id \
//      where lower(pr.email)='lefrancmathis@gmail.com'") \
//   node scripts/tournaments/upload-serie2-banners.mjs local scratchpad/serie2-banners

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// The organizer folder is part of the object path, so it has to match the
// organizer the SQL script uses (jdl.sonkin@gmail.com). Change both together.
const PROJECTS = {
  staging: { ref: 'ahbaeewecdeguxtxtvhr', organizer: '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537' },
  prod: { ref: 'ncewkeoohdkpbcovbppd', organizer: '9a4e8ac1-01a1-4333-819b-f947a22137ed' },
  // Local carries its own base and key: `supabase projects api-keys` only
  // knows hosted projects, and the local service key is the fixed demo one.
  local: {
    base: 'http://127.0.0.1:54321/storage/v1/object',
    key: process.env.SUPABASE_LOCAL_SERVICE_KEY,
    organizer: process.env.SERIE2_LOCAL_ORGANIZER,
  },
}

const EXPECTED = 3

const env = process.argv[2]
const dir = process.argv[3]
const project = PROJECTS[env]

if (!project || !dir) {
  console.error('usage: upload-serie2-banners.mjs <local|staging|prod> <bannerDir>')
  process.exit(1)
}

if (env === 'local' && (!project.organizer || !project.key)) {
  console.error(
    'local needs SERIE2_LOCAL_ORGANIZER (the organizer player id) and ' +
      'SUPABASE_LOCAL_SERVICE_KEY (from `supabase status`). See the header.'
  )
  process.exit(1)
}

let serviceKey = project.key
if (!serviceKey) {
  const keys = JSON.parse(
    execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project.ref], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
  )
  serviceKey = keys.keys.find((k) => k.id === 'service_role')?.api_key
  if (!serviceKey) throw new Error('service_role key not found in CLI output')
}

const base = project.base ?? `https://${project.ref}.supabase.co/storage/v1/object`
const files = (await readdir(dir)).filter((f) => f.startsWith('serie2-') && f.endsWith('.webp'))

if (files.length !== EXPECTED) {
  throw new Error(`expected ${EXPECTED} banners in ${dir}, found ${files.length}`)
}

for (const file of files) {
  const body = await readFile(path.join(dir, file))
  const target = `tournament-logos/${project.organizer}/${file}`

  const res = await fetch(`${base}/${target}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/webp',
      'x-upsert': 'true',
    },
    body,
  })

  if (!res.ok) {
    throw new Error(`${file}: ${res.status} ${await res.text()}`)
  }
  console.log(`uploaded ${target}`)
}

console.log(`\n${files.length} banners uploaded to ${env}`)
