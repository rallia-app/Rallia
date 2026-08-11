#!/usr/bin/env node
/**
 * Build the replies.json payload for the notification-mute follow-up.
 *
 * The opener (send-interview-outreach.mjs --campaign notif_mute_research) only
 * asks why they muted. This generates the SECOND message, which makes the case
 * for turning notifications back on, to be posted into the same 1-on-1 thread
 * by send-reply.mjs.
 *
 * READ-ONLY. It writes a JSON file; it never touches the database.
 *
 * --fix is REQUIRED and is the sentence describing what actually changed. The
 * whole message rests on that claim, so there is no default and no placeholder:
 * if the volume fix has not shipped yet, this follow-up cannot honestly be sent.
 *
 * Anyone who replied to the opener is EXCLUDED and listed for you to answer by
 * hand. A templated follow-up to someone who wrote a real answer reads as a
 * mail merge and burns the goodwill the opener earned.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/outreach/build-notif-mute-followup.mjs \
 *     --csv scripts/outreach/waves/notif-mute-wave1-nearby.csv \
 *     --fix "Nearby games are now one daily digest instead of a ping per game." \
 *     --out scripts/outreach/waves/notif-mute-followup.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SENDER_EMAIL = 'lefrancmathis@gmail.com';
const CAMPAIGN = 'notif_mute_research';

// {{name}} = first name, {{fix}} = the --fix sentence.
//
// Volume figures measured from prod on 2026-08-07. Re-measure before reusing.
//   - nearby_match_available: 15.6 sends per recipient per 30d, and 52% of
//     everything the muters received in their final week before muting.
//   - All types combined: 71.4 per user per 30d.
//
// The two segments make DIFFERENT claims on purpose. Muters who cut a handful
// of types were genuinely over-notified (34.1 in their final week vs 21.2 for a
// matched control). Muters who swept everything off were NOT (21.6 vs 21.2,
// statistically indistinguishable), so their copy states what we found
// platform-wide and what we changed, and never asserts volume was their reason.
const FOLLOWUP = {
  nearby_muted: {
    fr: [
      'Salut {{name}}, petit suivi là-dessus.',
      "J'ai regardé les chiffres pis t'avais raison: on envoyait environ 15 alertes de parties proches par mois, pis pour bien du monde ça représentait plus de la moitié de tout ce qu'on leur envoyait. Pas mal trop pour quelque chose que t'es supposé être content de voir.",
      '{{fix}}',
      "Si le coeur t'en dit, c'est dans Paramètres > Préférences de notifications. Aucune pression.",
    ],
    en: [
      'Hey {{name}}, following up on this.',
      "I went and looked at the numbers and you were right: we were firing about 15 nearby-game alerts a month, and for a lot of people that was more than half of everything we sent them. Way too many for something you're supposed to be glad to see.",
      '{{fix}}',
      'If you feel like giving it another shot, it lives in Settings > Notification Preferences. No pressure either way.',
    ],
  },
  all_muted: {
    fr: [
      'Salut {{name}}, petit suivi là-dessus.',
      "Peu importe la raison, ça m'a poussé à regarder ce qu'on envoyait: plus de 70 notifications par mois pour le joueur moyen. C'était trop, fait qu'on a changé ça.",
      '{{fix}}',
      "Si le coeur t'en dit, c'est dans Paramètres > Préférences de notifications. Aucune pression.",
    ],
    en: [
      'Hey {{name}}, following up on this.',
      'Whatever the reason was, it got me to go look at what we were actually sending: over 70 notifications a month for the average player. That was too much, so we changed it.',
      '{{fix}}',
      'If you feel like turning some back on, they live in Settings > Notification Preferences. No pressure either way.',
    ],
  },
};

function parseArgs(argv) {
  const o = { csv: [], out: null, fix: null, sender: SENDER_EMAIL, campaign: CAMPAIGN };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') o.csv.push(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--fix') o.fix = argv[++i];
    else if (a === '--sender') o.sender = argv[++i];
    else if (a === '--campaign') o.campaign = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function parseCsv(path) {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim().length && !l.trim().startsWith('#'));
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iEmail = header.indexOf('email');
  const iSeg = header.indexOf('segment');
  if (iEmail === -1 || iSeg === -1) throw new Error(`CSV needs 'email' and 'segment' columns: ${path}`);
  return lines.slice(1).map(l => {
    const c = l.split(',');
    return { email: (c[iEmail] || '').trim().toLowerCase(), segment: (c[iSeg] || '').trim() };
  }).filter(r => r.email);
}

const localeToLang = loc => (loc && loc.toLowerCase().startsWith('fr') ? 'fr' : 'en');

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.csv.length) {
    console.log('Usage: --csv <path> [--csv <path>] --fix "<what changed>" [--out path]');
    return;
  }
  if (!o.fix) {
    console.error('\n--fix is required: one sentence naming what actually changed about the volume.');
    console.error('If nothing has shipped yet, this follow-up is not truthful and must not be sent.\n');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const recipients = o.csv.flatMap(parseCsv);
  const { data: sender } = await supabase
    .from('profile').select('id, first_name').ilike('email', o.sender).limit(1).maybeSingle();
  if (!sender) {
    console.error(`Sender not found: ${o.sender}`);
    process.exit(1);
  }

  const payload = [];
  const replied = [];
  const missing = [];

  for (const r of recipients) {
    const { data: profile } = await supabase
      .from('profile').select('id, first_name, preferred_locale').ilike('email', r.email).limit(1).maybeSingle();
    if (!profile) { missing.push(`${r.email} (no profile)`); continue; }

    // Find the 1-on-1 thread that carries this campaign's opener.
    const { data: rows } = await supabase
      .from('conversation_participant')
      .select('conversation_id, conversation:conversation!inner(conversation_type)')
      .eq('player_id', profile.id)
      .limit(200);
    const directIds = [...new Set((rows || [])
      .filter(x => x.conversation?.conversation_type === 'direct')
      .map(x => x.conversation_id))];

    let convId = null;
    let openerAt = null;
    for (const cid of directIds) {
      const { data: msgs } = await supabase
        .from('message').select('id, created_at')
        .eq('conversation_id', cid)
        .contains('metadata', { campaign: o.campaign })
        .limit(1);
      if (msgs && msgs.length) { convId = cid; openerAt = msgs[0].created_at; break; }
    }
    if (!convId) { missing.push(`${r.email} (no ${o.campaign} thread)`); continue; }

    // Anyone who answered gets a hand-written reply, not this template.
    const { data: theirReplies } = await supabase
      .from('message').select('id')
      .eq('conversation_id', convId)
      .eq('sender_id', profile.id)
      .gt('created_at', openerAt)
      .limit(1);
    if (theirReplies && theirReplies.length) {
      replied.push(`${r.email}  conv=${convId}`);
      continue;
    }

    const tpl = FOLLOWUP[r.segment]?.[localeToLang(profile.preferred_locale)];
    if (!tpl) { missing.push(`${r.email} (no template for segment "${r.segment}")`); continue; }
    const text = tpl
      .map(line => line.replaceAll('{{name}}', (profile.first_name || '').trim()).replaceAll('{{fix}}', o.fix))
      .join('\n');
    payload.push({ conversation_id: convId, text, label: `${r.email} ${r.segment}` });
  }

  const json = JSON.stringify(payload, null, 2);
  if (o.out) {
    writeFileSync(o.out, json);
    console.log(`Wrote ${payload.length} follow-ups to ${o.out}`);
  } else {
    console.log(json);
  }

  console.log(`\n  queued          : ${payload.length}`);
  console.log(`  replied (manual): ${replied.length}`);
  for (const x of replied) console.log(`      ${x}`);
  console.log(`  skipped         : ${missing.length}`);
  for (const x of missing) console.log(`      ${x}`);
  console.log('\nPost with: node scripts/outreach/send-reply.mjs --file <out> --allow-prod   (add --execute to send)');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
