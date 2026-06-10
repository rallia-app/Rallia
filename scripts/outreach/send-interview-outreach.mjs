#!/usr/bin/env node
/**
 * User-interview outreach sender.
 *
 * For each recipient it ensures a 3-person GROUP conversation exists
 * (the recipient + both founders) and posts the cohort-appropriate
 * outreach message into it, sent from Mathis.
 *
 * SAFE BY DEFAULT:
 *   - Dry run unless you pass --execute (no writes otherwise).
 *   - Refuses to run against the prod project ref unless you ALSO pass --allow-prod.
 *   - Idempotent: skips a recipient who already has this campaign's message,
 *     and reuses an existing founder+recipient group thread instead of duplicating it.
 *
 * Required env:
 *   SUPABASE_URL                e.g. https://ahbaeewecdeguxtxtvhr.supabase.co   (staging)
 *   SUPABASE_SERVICE_ROLE_KEY   staging service_role key (bypasses RLS)
 *
 * Examples (run from repo root):
 *   # dry run, one recipient
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/outreach/send-interview-outreach.mjs --recipient someone@staging.test:one_session
 *
 *   # dry run from a CSV (columns: email,segment[,locale])
 *   ... node scripts/outreach/send-interview-outreach.mjs --csv ./recipients.csv
 *
 *   # actually write (still staging-only unless --allow-prod)
 *   ... node scripts/outreach/send-interview-outreach.mjs --csv ./recipients.csv --execute
 *
 * Segments: new | active | one_session | drifted
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FOUNDER_EMAILS = ['lefrancmathis@gmail.com', 'jdl.sonkin@gmail.com'];
const SENDER_EMAIL = 'lefrancmathis@gmail.com'; // message author
const FOUNDER_LABEL = 'Jean & Mathis'; // used in the conversation title
const CAMPAIGN = 'user_interview_outreach';
const PROD_REF = 'ncewkeoohdkpbcovbppd';
const VALID_SEGMENTS = new Set(['new', 'active', 'one_session', 'drifted']);
const CALENDLY = 'https://calendly.com/apprallia/15min';

// Each template is an array of lines joined into ONE message with line breaks.
// {{name}} is replaced with the recipient's first name.
const MESSAGES = {
  new: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. On aimerait vraiment savoir comment tu trouves ça jusqu'à maintenant.",
      "Est-ce que t'as réussi à jouer une partie depuis ton arrivée?",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. We'd love to hear how it's been for you so far.",
      'Have you managed to actually get a game in since you joined?',
    ],
  },
  active: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Ça fait un bout que t'utilises l'app pis on aimerait vraiment avoir ton avis.",
      "Qu'est-ce qui marche bien pour toi, pis qu'est-ce qui t'accroche des fois?",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a while now and we'd really love your take.",
      "What's been working well for you, and what trips you up sometimes?",
    ],
  },
  one_session: {
    fr: [
      "Salut {{name}}, nous c'est Jean et Mathis, les deux derrière Rallia 👋",
      "On a vu que tu t'étais inscrit mais que t'as pas vraiment eu la chance d'essayer l'app, et c'est justement ce qu'on cherche à comprendre.",
      "Pas de pitch, on veut juste savoir ce qui t'a arrêté. Ça nous aiderait beaucoup.",
      `Aurais-tu 15 min cette semaine? ${CALENDLY}`,
    ],
    en: [
      "Hey {{name}}, it's Jean and Mathis, the two behind Rallia 👋",
      "We saw you signed up but never really got the chance to give it a real try, and that's exactly what we're trying to understand.",
      'No pitch, we just want to know what stopped you. It would help us a lot.',
      `Would you have 15 min this week? ${CALENDLY}`,
    ],
  },
  drifted: {
    fr: [
      "Salut {{name}}, nous c'est Jean et Mathis, les deux derrière Rallia 👋",
      "On a vu que tu l'avais utilisé un bout pis que t'es pas trop revenu depuis, et c'est justement ce qu'on cherche à comprendre.",
      "Pas de pitch, on veut juste savoir ce qui a fait que ça a arrêté de cliquer. Ça nous aiderait pour vrai.",
      `Aurais-tu 15 min cette semaine? ${CALENDLY}`,
    ],
    en: [
      "Hey {{name}}, it's Jean and Mathis, the two behind Rallia 👋",
      "We saw you used it for a bit then kind of dropped off, and that's exactly what we're trying to understand.",
      'No pitch, we just want to know what made it stop clicking for you. It would genuinely help.',
      `Would you have 15 min this week? ${CALENDLY}`,
    ],
  },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    execute: false,
    allowProd: false,
    title: null, // static override; default is a per-recipient title
    sender: SENDER_EMAIL,
    csv: null,
    recipients: [],
    limit: Infinity,
    allowMissingName: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') opts.execute = true;
    else if (a === '--allow-prod') opts.allowProd = true;
    else if (a === '--allow-missing-name') opts.allowMissingName = true;
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--sender') opts.sender = argv[++i];
    else if (a === '--csv') opts.csv = argv[++i];
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--recipient') opts.recipients.push(argv[++i]);
    else if (a === '--preview') opts.preview = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function parseRecipientToken(tok) {
  // "email:segment[:locale]"
  const [email, segment, locale] = tok.split(':');
  return { email: (email || '').trim().toLowerCase(), segment: (segment || '').trim(), locale: (locale || '').trim() || null };
}

function parseCsv(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iEmail = header.indexOf('email');
  const iSeg = header.indexOf('segment');
  const iLoc = header.indexOf('locale');
  if (iEmail === -1 || iSeg === -1) {
    throw new Error(`CSV must have at least 'email' and 'segment' columns. Found: ${header.join(', ')}`);
  }
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return {
      email: (cells[iEmail] || '').trim().toLowerCase(),
      segment: (cells[iSeg] || '').trim(),
      locale: iLoc === -1 ? null : (cells[iLoc] || '').trim() || null,
    };
  }).filter(r => r.email);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const localeToLang = loc => (loc && loc.toLowerCase().startsWith('fr') ? 'fr' : 'en');

const buildTitle = firstName => (firstName ? `${firstName}, ${FOUNDER_LABEL}` : FOUNDER_LABEL);

function buildContent(segment, lang, firstName) {
  const tpl = MESSAGES[segment][lang];
  return tpl.map(line => line.replaceAll('{{name}}', firstName)).join('\n');
}

function refFromUrl(url) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return '(unparseable)';
  }
}

async function resolveProfileByEmail(supabase, email) {
  const { data, error } = await supabase
    .from('profile')
    .select('id, email, first_name, preferred_locale, account_status')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Find an existing GROUP conversation whose participant set is exactly
// {recipient, ...founders}. Returns conversation id or null.
async function findExistingGroup(supabase, recipientId, founderIds) {
  const want = new Set([recipientId, ...founderIds]);
  const { data: rows, error } = await supabase
    .from('conversation_participant')
    .select('conversation_id, conversation:conversation!inner(conversation_type)')
    .eq('player_id', recipientId)
    .eq('conversation.conversation_type', 'group')
    .limit(200);
  if (error) throw error;
  const candidateIds = [...new Set((rows || []).map(r => r.conversation_id))];
  for (const cid of candidateIds) {
    const { data: parts, error: pErr } = await supabase
      .from('conversation_participant')
      .select('player_id')
      .eq('conversation_id', cid);
    if (pErr) throw pErr;
    const have = new Set((parts || []).map(p => p.player_id));
    if (have.size === want.size && [...want].every(id => have.has(id))) return cid;
  }
  return null;
}

async function hasCampaignMessage(supabase, conversationId) {
  const { data, error } = await supabase
    .from('message')
    .select('id')
    .eq('conversation_id', conversationId)
    .filter('metadata->>campaign', 'eq', CAMPAIGN)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function createGroupConversation(supabase, senderId, participantIds, title) {
  const { data: conv, error } = await supabase
    .from('conversation')
    .insert({ conversation_type: 'group', title: title || null, created_by: senderId, picture_url: null })
    .select()
    .single();
  if (error) throw error;
  const rows = participantIds.map(pid => ({ conversation_id: conv.id, player_id: pid }));
  const { error: pErr } = await supabase.from('conversation_participant').insert(rows);
  if (pErr) {
    await supabase.from('conversation').delete().eq('id', conv.id); // clean up
    throw pErr;
  }
  return conv.id;
}

async function postMessage(supabase, conversationId, senderId, content, segment) {
  const { data, error } = await supabase
    .from('message')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      status: 'sent',
      message_type: 'user',
      metadata: { campaign: CAMPAIGN, segment },
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('See header comment in this file for usage. Segments: new | active | one_session | drifted');
    return;
  }

  if (opts.preview) {
    const name = 'Alex';
    console.log(`Message previews (sample name: "${name}")`);
    for (const seg of VALID_SEGMENTS) {
      for (const lang of ['fr', 'en']) {
        console.log(`\n=== ${seg} / ${lang} ===`);
        console.log(buildContent(seg, lang, name));
      }
    }
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  const ref = refFromUrl(url);
  const isProd = ref === PROD_REF;
  if (isProd && !opts.allowProd) {
    console.error(`\nRefusing to run: SUPABASE_URL points at the PROD project (${ref}).`);
    console.error('Point it at staging, or pass --allow-prod if you really mean it.\n');
    process.exit(1);
  }

  // Gather recipients
  let recipients = [...opts.recipients.map(parseRecipientToken)];
  if (opts.csv) recipients = recipients.concat(parseCsv(opts.csv));
  recipients = recipients.filter(r => r.email);
  if (Number.isFinite(opts.limit)) recipients = recipients.slice(0, opts.limit);
  if (!recipients.length) {
    console.error('No recipients. Pass --recipient email:segment or --csv path.');
    process.exit(1);
  }
  for (const r of recipients) {
    if (!VALID_SEGMENTS.has(r.segment)) {
      console.error(`Recipient ${r.email} has invalid segment "${r.segment}". Valid: ${[...VALID_SEGMENTS].join(', ')}`);
      process.exit(1);
    }
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const mode = opts.execute ? 'EXECUTE (writing)' : 'DRY RUN (no writes)';
  console.log('============================================================');
  console.log(` Rallia interview outreach  |  ${mode}`);
  console.log(` Project ref: ${ref}${isProd ? '  *** PROD ***' : '  (staging)'}`);
  console.log(` Recipients: ${recipients.length}  |  Title: ${opts.title ? `"${opts.title}"` : `"<first name>, ${FOUNDER_LABEL}"`}`);
  console.log('============================================================\n');

  // Resolve founders
  const founders = {};
  for (const email of FOUNDER_EMAILS) {
    const p = await resolveProfileByEmail(supabase, email);
    if (!p) {
      console.error(`Founder account not found on this project: ${email}. Aborting.`);
      process.exit(1);
    }
    founders[email] = p;
  }
  const sender = founders[opts.sender] || (await resolveProfileByEmail(supabase, opts.sender));
  if (!sender) {
    console.error(`Sender account not found: ${opts.sender}. Aborting.`);
    process.exit(1);
  }
  const founderIds = FOUNDER_EMAILS.map(e => founders[e].id);
  console.log(`Founders: ${FOUNDER_EMAILS.map(e => `${founders[e].first_name} <${e}>`).join(', ')}`);
  console.log(`Sender:   ${sender.first_name} <${sender.email}>\n`);

  const summary = { created: 0, reused: 0, alreadySent: 0, notFound: 0, skippedNoName: 0, errors: 0 };

  for (const r of recipients) {
    try {
      const profile = await resolveProfileByEmail(supabase, r.email);
      if (!profile) {
        console.log(`SKIP  ${r.email}  -> not found on this project`);
        summary.notFound++;
        continue;
      }
      if (founderIds.includes(profile.id)) {
        console.log(`SKIP  ${r.email}  -> that's a founder account`);
        continue;
      }
      const lang = localeToLang(r.locale || profile.preferred_locale);
      const firstName = (profile.first_name || '').trim();
      if (!firstName && !opts.allowMissingName) {
        console.log(`SKIP  ${r.email}  -> no first name (use --allow-missing-name to send anyway)`);
        summary.skippedNoName++;
        continue;
      }
      const content = buildContent(r.segment, lang, firstName);
      const title = opts.title || buildTitle(firstName);
      const participantIds = [profile.id, ...founderIds];

      let convId = await findExistingGroup(supabase, profile.id, founderIds);
      let convAction = convId ? 'reuse' : 'create';

      if (convId && (await hasCampaignMessage(supabase, convId))) {
        console.log(`SKIP  ${r.email}  -> campaign message already exists in conversation ${convId}`);
        summary.alreadySent++;
        continue;
      }

      const previewFirst = content.split('\n')[0];
      const status = profile.account_status && profile.account_status !== 'active' ? ` [account:${profile.account_status}]` : '';
      console.log(`${opts.execute ? 'SEND' : 'PLAN'}  ${r.email}  seg=${r.segment} lang=${lang} conv=${convAction}${convId ? `(${convId})` : ''}${status}`);
      console.log(`      title: "${title}"`);
      console.log(`      "${previewFirst}"  (${content.length} chars, ${content.split('\n').length} lines)`);

      if (!opts.execute) continue;

      if (!convId) {
        convId = await createGroupConversation(supabase, sender.id, participantIds, title);
        summary.created++;
        console.log(`      created conversation ${convId} with ${participantIds.length} participants`);
      } else {
        summary.reused++;
      }
      const msgId = await postMessage(supabase, convId, sender.id, content, r.segment);
      console.log(`      posted message ${msgId}`);
    } catch (err) {
      summary.errors++;
      console.error(`ERROR ${r.email}  -> ${err.message || err}`);
    }
  }

  console.log('\n------------------------------------------------------------');
  console.log(' Summary');
  console.log(`   conversations created : ${summary.created}`);
  console.log(`   conversations reused  : ${summary.reused}`);
  console.log(`   already sent (skipped): ${summary.alreadySent}`);
  console.log(`   not found (skipped)   : ${summary.notFound}`);
  console.log(`   no name (skipped)     : ${summary.skippedNoName}`);
  console.log(`   errors                : ${summary.errors}`);
  if (!opts.execute) console.log('\n   DRY RUN: nothing was written. Re-run with --execute to send.');
  console.log('------------------------------------------------------------');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
