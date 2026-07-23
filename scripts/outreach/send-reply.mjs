#!/usr/bin/env node
/**
 * Post a one-off reply into an EXISTING outreach conversation.
 *
 * The campaign sender (send-interview-outreach.mjs) only creates new threads.
 * This posts a follow-up into a thread that already exists, e.g. answering
 * someone who replied to the outreach.
 *
 * Metadata note: this deliberately does NOT set metadata.campaign. The reply-rate
 * query groups by (conversation_id, metadata->>'segment') across campaign-tagged
 * messages, so a second campaign-tagged row in the same thread would create a
 * duplicate group and inflate the wave's sent count. Tagged `followup` instead.
 *
 * SAFE BY DEFAULT:
 *   - Dry run unless you pass --execute.
 *   - Refuses the prod project ref unless you ALSO pass --allow-prod.
 *   - Verifies the conversation exists and the sender is a participant before posting.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/outreach/send-reply.mjs --file replies.json --allow-prod
 *   node scripts/outreach/send-reply.mjs --file replies.json --allow-prod --execute
 *
 * replies.json shape:
 *   [{ "conversation_id": "<uuid>", "text": "message body", "label": "optional note" }]
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SENDER_EMAIL = 'lefrancmathis@gmail.com';
const PROD_REF = 'ncewkeoohdkpbcovbppd';

function parseArgs(argv) {
  const o = { file: null, execute: false, allowProd: false, sender: SENDER_EMAIL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.file = argv[++i];
    else if (a === '--execute') o.execute = true;
    else if (a === '--allow-prod') o.allowProd = true;
    else if (a === '--sender') o.sender = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const refFromUrl = url => { try { return new URL(url).hostname.split('.')[0]; } catch { return '(?)'; } };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.file) {
    console.log('Usage: --file replies.json [--execute] [--allow-prod] [--sender email]');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const ref = refFromUrl(url);
  const isProd = ref === PROD_REF;
  if (isProd && !o.allowProd) {
    console.error(`\nRefusing to run: SUPABASE_URL points at PROD (${ref}). Pass --allow-prod if you mean it.\n`);
    process.exit(1);
  }

  const replies = JSON.parse(readFileSync(o.file, 'utf8'));
  if (!Array.isArray(replies) || !replies.length) { console.error('replies file must be a non-empty array.'); process.exit(1); }
  for (const r of replies) {
    if (!r.conversation_id || !r.text) { console.error(`Each entry needs conversation_id and text. Bad entry: ${JSON.stringify(r)}`); process.exit(1); }
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: sender, error: sErr } = await supabase
    .from('profile').select('id, email, first_name').ilike('email', o.sender).limit(1).maybeSingle();
  if (sErr) throw sErr;
  if (!sender) { console.error(`Sender not found: ${o.sender}`); process.exit(1); }

  console.log('============================================================');
  console.log(` Outreach reply  |  ${o.execute ? 'EXECUTE (writing)' : 'DRY RUN (no writes)'}`);
  console.log(` Project ref: ${ref}${isProd ? '  *** PROD ***' : ''}`);
  console.log(` Replies: ${replies.length}  |  Sender: ${sender.first_name} <${sender.email}>`);
  console.log('============================================================\n');

  const summary = { posted: 0, skipped: 0, errors: 0 };

  for (const r of replies) {
    try {
      // Confirm the conversation exists and the sender is actually in it.
      const { data: parts, error: pErr } = await supabase
        .from('conversation_participant').select('player_id').eq('conversation_id', r.conversation_id);
      if (pErr) throw pErr;
      if (!parts || !parts.length) {
        console.log(`SKIP  ${r.conversation_id}  -> conversation not found / no participants`);
        summary.skipped++;
        continue;
      }
      if (!parts.some(p => p.player_id === sender.id)) {
        console.log(`SKIP  ${r.conversation_id}  -> sender is not a participant`);
        summary.skipped++;
        continue;
      }

      console.log(`${o.execute ? 'POST' : 'PLAN'}  ${r.conversation_id}${r.label ? `  (${r.label})` : ''}`);
      console.log(`      "${r.text}"`);
      if (!o.execute) continue;

      const { data: msg, error: mErr } = await supabase
        .from('message')
        .insert({
          conversation_id: r.conversation_id,
          sender_id: sender.id,
          content: r.text,
          status: 'sent',
          message_type: 'user',
          metadata: { followup: 'user_interview_outreach' },
        })
        .select('id').single();
      if (mErr) throw mErr;
      console.log(`      posted message ${msg.id}`);
      summary.posted++;
    } catch (err) {
      summary.errors++;
      console.error(`ERROR ${r.conversation_id}  -> ${err.message || err}`);
    }
  }

  console.log('\n------------------------------------------------------------');
  console.log(` posted : ${summary.posted}`);
  console.log(` skipped: ${summary.skipped}`);
  console.log(` errors : ${summary.errors}`);
  if (!o.execute) console.log('\n DRY RUN: nothing was written. Re-run with --execute to post.');
  console.log('------------------------------------------------------------');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
