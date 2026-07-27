#!/usr/bin/env node
// Uploads the generated Serie 1 banners to a project's tournament-logos bucket.
// Storage doesn't travel by migration, so this runs once per environment before
// the migration that writes logo_url.
//
// The service_role key is pulled from the Supabase CLI session rather than an
// env file, so nothing secret lands on disk.
//
// Usage: node scripts/tournaments/upload-serie1-banners.mjs <staging|prod> <bannerDir>

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PROJECTS = {
  staging: { ref: 'ahbaeewecdeguxtxtvhr', organizer: '4ed1fa69-c3c4-4d24-83bf-948fb5a9a537' },
  prod: { ref: 'ncewkeoohdkpbcovbppd', organizer: '9a4e8ac1-01a1-4333-819b-f947a22137ed' },
}

const env = process.argv[2]
const dir = process.argv[3]
const project = PROJECTS[env]

if (!project || !dir) {
  console.error('usage: upload-serie1-banners.mjs <staging|prod> <bannerDir>')
  process.exit(1)
}

const keys = JSON.parse(
  execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project.ref], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
)
const serviceKey = keys.keys.find((k) => k.id === 'service_role')?.api_key
if (!serviceKey) throw new Error('service_role key not found in CLI output')

const base = `https://${project.ref}.supabase.co/storage/v1/object`
const files = (await readdir(dir)).filter((f) => f.startsWith('serie1-') && f.endsWith('.webp'))

if (files.length !== 9) {
  throw new Error(`expected 9 banners in ${dir}, found ${files.length}`)
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
