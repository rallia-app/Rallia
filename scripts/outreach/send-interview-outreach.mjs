#!/usr/bin/env node
/**
 * User-interview outreach sender.
 *
 * For each recipient it ensures a 3-person GROUP conversation exists
 * (the recipient + both founders) and posts the cohort-appropriate
 * outreach message into it, sent from Mathis.
 *
 * With --direct it uses a 1-on-1 conversation between the recipient and the
 * sender instead. Use --campaign to namespace idempotency per campaign;
 * without it, anyone already messaged by any earlier wave is skipped.
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
const DEFAULT_CAMPAIGN = 'user_interview_outreach';
const PROD_REF = 'ncewkeoohdkpbcovbppd';
const VALID_SEGMENTS = new Set([
  'new', 'active', 'one_session', 'drifted',
  // A/B/C interview-ask experiment (active users)
  'test_casual', 'test_link', 'test_nolink',
  // Winner rollout: warm direct ask, no link
  'active_warm',
  // Active-window (14-60d signup) waves — differentiated by games played
  'aw_never', 'aw_tried', 'aw_regular',
  // Notification-mute research (1-on-1, --direct). Split by how broadly they muted.
  'nearby_muted', 'all_muted',
]);
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
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu utilises l'app depuis un moment et on aimerait vraiment avoir ton avis.",
      "Qu'est-ce qui marche bien pour toi, et qu'est-ce qui t'accroche parfois?",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a while now and we'd really love your take.",
      "What's been working well for you, and what trips you up sometimes?",
    ],
  },

  // --- A/B/C interview-ask experiment. Identical intro across arms; only the 3rd line (the ask) differs. ---
  // Arm A: casual hook, no interview ask (same as `active`).
  test_casual: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu utilises l'app depuis un moment et on aimerait vraiment avoir ton avis.",
      "Qu'est-ce qui marche bien pour toi, et qu'est-ce qui t'accroche parfois?",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a while now and we'd really love your take.",
      "What's been working well for you, and what trips you up sometimes?",
    ],
  },
  // Arm B: direct interview ask + Calendly link.
  test_link: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu utilises l'app depuis un moment et on aimerait vraiment avoir ton avis.",
      `Aurais-tu 15 min pour discuter de ton expérience? Tu peux réserver le moment qui te convient ici: ${CALENDLY}`,
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a while now and we'd really love your take.",
      `Would you have 15 min for a quick call about your experience? You can grab a time that works for you here: ${CALENDLY}`,
    ],
  },
  // Arm C: direct interview ask, no link.
  test_nolink: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu utilises l'app depuis un moment et on aimerait vraiment avoir ton avis.",
      "Aurais-tu 15 min cette semaine pour discuter de ton expérience?",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a while now and we'd really love your take.",
      'Would you have 15 min this week for a quick call about your experience?',
    ],
  },
  // Rollout: warmer version of the direct ask — question first, interview ask as soft invite.
  active_warm: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu utilises l'app depuis un moment et on voulait vraiment savoir comment ça se passe pour toi.",
      "Est-ce que t'as réussi à jouer des parties? Si t'as 15 min pour en jaser sur appel cette semaine, on serait vraiment preneurs.",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You've been using the app for a bit and we really wanted to know how it's been going for you.",
      "Have you managed to get some games in? If you have 15 min to chat on a call this week, we'd really love that.",
    ],
  },
  // Active-window waves (14-60d signup), differentiated by games played
  aw_never: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. Tu as rejoint l'app il y a quelques semaines et on voulait vraiment prendre de tes nouvelles.",
      "T'as eu la chance d'essayer? Si t'as 15 min pour jaser sur appel cette semaine, on serait preneurs.",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. You joined a few weeks back and we really wanted to check in.",
      "Have you had a chance to try it out? If you have 15 min for a call this week, we'd love that.",
    ],
  },
  aw_tried: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. On a vu que t'as joué tes premières parties pis on voulait vraiment savoir comment ça s'est passé.",
      "Si t'as 15 min pour en jaser sur appel cette semaine, on serait vraiment preneurs.",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. We saw you played your first game(s) on Rallia and we really wanted to know how it went.",
      "If you have 15 min to chat on a call this week, we'd really love that.",
    ],
  },
  aw_regular: {
    fr: [
      'Salut {{name}}!',
      "Nous c'est Mathis et Jean, les deux derrière Rallia. On voit que tu joues régulièrement, t'es exactement le genre de joueur dont on a besoin pour mieux comprendre ce qui marche.",
      "T'aurais 15 min pour jaser sur appel cette semaine? Ton feedback compte vraiment pour nous.",
    ],
    en: [
      'Hey {{name}}!',
      "We're Mathis and Jean, the two behind Rallia. We can see you've been playing regularly, so you're exactly the kind of player we need to hear from.",
      "Would you have 15 min for a call this week? Your feedback really matters to us.",
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

  // --- Notification-mute research. Sent 1-on-1 from Mathis (--direct), so the
  // voice is singular, not the usual "Jean and Mathis". This opener only asks
  // the question. It deliberately makes no promise about never asking them to
  // re-enable, because the planned follow-up does exactly that once the volume
  // fix ships (see build-notif-mute-followup.mjs).
  // `nearby_muted` = muted a handful of types including nearby games.
  nearby_muted: {
    fr: [
      'Salut {{name}}!',
      "C'est Mathis, un des deux derrière Rallia. J'ai remarqué que t'avais fermé les notifications pour les nouvelles parties proches de chez toi.",
      "Aucun jugement, je veux juste comprendre ce qui t'a poussé là: y'en avait trop, ou les parties fittaient juste pas? Ce que tu me dis s'en va direct dans ma liste de choses à arranger.",
    ],
    en: [
      'Hey {{name}}!',
      'Mathis here, one of the two behind Rallia. I noticed you turned off the notifications for new games near you a while back.',
      'No judgment at all, I just want to understand what pushed you there: were there too many, or were the games not the right fit? Whatever you tell me goes straight into what I fix next.',
    ],
  },
  // `all_muted` = swept most notification types off, not a nearby-specific choice.
  all_muted: {
    fr: [
      'Salut {{name}}!',
      "C'est Mathis, un des deux derrière Rallia. J'ai remarqué que t'avais fermé pas mal toutes tes notifications.",
      "Aucun jugement, je veux juste comprendre ce qui t'a poussé là: y'en avait trop, mauvais moment, ou juste pas utile? Ce que tu me dis s'en va direct dans ma liste de choses à arranger.",
    ],
    en: [
      'Hey {{name}}!',
      'Mathis here, one of the two behind Rallia. I noticed you turned off pretty much all your notifications a while back.',
      'No judgment at all, I just want to understand what pushed you there: too many, wrong timing, or just not useful? Whatever you tell me goes straight into what I fix next.',
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
    direct: false,
    campaign: DEFAULT_CAMPAIGN,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') opts.execute = true;
    else if (a === '--allow-prod') opts.allowProd = true;
    else if (a === '--allow-missing-name') opts.allowMissingName = true;
    else if (a === '--direct') opts.direct = true;
    else if (a === '--campaign') opts.campaign = argv[++i];
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
// Note: we fetch ALL conversations the recipient is in and filter conversation_type
// in JS — the PostgREST nested-table filter (.eq('conversation.x', v)) silently
// drops the condition on some client versions, so we can't rely on it server-side.
async function findExistingGroup(supabase, recipientId, founderIds) {
  const want = new Set([recipientId, ...founderIds]);
  const { data: rows, error } = await supabase
    .from('conversation_participant')
    .select('conversation_id, conversation:conversation!inner(conversation_type)')
    .eq('player_id', recipientId)
    .limit(200);
  if (error) throw error;
  const candidateIds = [...new Set(
    (rows || [])
      .filter(r => r.conversation?.conversation_type === 'group')
      .map(r => r.conversation_id)
  )];
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

// Find an existing 1-on-1 conversation between exactly {recipient, sender}.
// Same JS-side filtering rationale as findExistingGroup above.
async function findExistingDirect(supabase, recipientId, senderId) {
  const want = new Set([recipientId, senderId]);
  const { data: rows, error } = await supabase
    .from('conversation_participant')
    .select('conversation_id, conversation:conversation!inner(conversation_type, match_id)')
    .eq('player_id', recipientId)
    .limit(200);
  if (error) throw error;
  const candidateIds = [...new Set(
    (rows || [])
      .filter(r => r.conversation?.conversation_type === 'direct' && !r.conversation?.match_id)
      .map(r => r.conversation_id)
  )];
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

async function hasCampaignMessage(supabase, conversationId, campaign) {
  const { data, error } = await supabase
    .from('message')
    .select('id')
    .eq('conversation_id', conversationId)
    .contains('metadata', { campaign })
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// Fallback idempotency check: does this player have a campaign message in ANY
// conversation they're part of? Catches cases where findExistingGroup returns null
// (e.g. the conversation was somehow not found) but a message was already sent.
async function hasAnyCampaignMessageForPlayer(supabase, playerId, campaign) {
  const { data: convRows, error: cErr } = await supabase
    .from('conversation_participant')
    .select('conversation_id')
    .eq('player_id', playerId);
  if (cErr) throw cErr;
  if (!convRows || convRows.length === 0) return false;
  const ids = convRows.map(r => r.conversation_id);
  const { data: msgs, error: mErr } = await supabase
    .from('message')
    .select('id')
    .in('conversation_id', ids)
    .contains('metadata', { campaign })
    .limit(1);
  if (mErr) throw mErr;
  return (msgs || []).length > 0;
}

// `type` is 'group' or 'direct'. Direct threads carry no title: the client
// renders them from the other participant's name.
async function createConversation(supabase, senderId, participantIds, title, type = 'group') {
  const { data: conv, error } = await supabase
    .from('conversation')
    .insert({
      conversation_type: type,
      title: type === 'direct' ? null : title || null,
      created_by: senderId,
      picture_url: null,
    })
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

async function postMessage(supabase, conversationId, senderId, content, segment, campaign) {
  const { data, error } = await supabase
    .from('message')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      status: 'sent',
      message_type: 'user',
      metadata: { campaign, segment },
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
  const threadDesc = opts.direct
    ? '1-on-1 with sender'
    : `group, title ${opts.title ? `"${opts.title}"` : `"<first name>, ${FOUNDER_LABEL}"`}`;
  console.log('============================================================');
  console.log(` Rallia outreach  |  ${mode}`);
  console.log(` Project ref: ${ref}${isProd ? '  *** PROD ***' : '  (staging)'}`);
  console.log(` Campaign: ${opts.campaign}`);
  console.log(` Recipients: ${recipients.length}  |  Thread: ${threadDesc}`);
  console.log('============================================================\n');

  // Resolve founders. 1-on-1 threads only ever contain the recipient and the
  // sender, so a missing co-founder account is irrelevant there.
  const founders = {};
  for (const email of FOUNDER_EMAILS) {
    const p = await resolveProfileByEmail(supabase, email);
    if (!p && !opts.direct) {
      console.error(`Founder account not found on this project: ${email}. Aborting.`);
      process.exit(1);
    }
    if (p) founders[email] = p;
  }
  const sender = founders[opts.sender] || (await resolveProfileByEmail(supabase, opts.sender));
  if (!sender) {
    console.error(`Sender account not found: ${opts.sender}. Aborting.`);
    process.exit(1);
  }
  const founderIds = FOUNDER_EMAILS.filter(e => founders[e]).map(e => founders[e].id);
  if (!opts.direct) {
    console.log(`Founders: ${FOUNDER_EMAILS.map(e => `${founders[e].first_name} <${e}>`).join(', ')}`);
  }
  console.log(`Sender:   ${sender.first_name} <${sender.email}>\n`);

  const summary = { created: 0, reused: 0, alreadySent: 0, notFound: 0, skippedNoName: 0, skippedNoPlayer: 0, errors: 0 };

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
      // A profile with no matching player row can't be added to a conversation
      // (conversation_participant.player_id FKs to player). This happens when someone
      // creates an account but abandons onboarding. Skip cleanly instead of erroring.
      const { data: playerRow, error: plErr } = await supabase
        .from('player').select('id').eq('id', profile.id).maybeSingle();
      if (plErr) throw plErr;
      if (!playerRow) {
        console.log(`SKIP  ${r.email}  -> profile has no player row (never onboarded)`);
        summary.skippedNoPlayer++;
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
      // 1-on-1 mode pairs the recipient with the sender only; group mode adds both founders.
      const participantIds = opts.direct ? [profile.id, sender.id] : [profile.id, ...founderIds];

      // Idempotency: check for any prior campaign message for this player first
      // (catches cases where the conversation lookup misses the thread).
      if (await hasAnyCampaignMessageForPlayer(supabase, profile.id, opts.campaign)) {
        console.log(`SKIP  ${r.email}  -> campaign message already exists`);
        summary.alreadySent++;
        continue;
      }

      let convId = opts.direct
        ? await findExistingDirect(supabase, profile.id, sender.id)
        : await findExistingGroup(supabase, profile.id, founderIds);
      let convAction = convId ? 'reuse' : 'create';

      if (convId && (await hasCampaignMessage(supabase, convId, opts.campaign))) {
        console.log(`SKIP  ${r.email}  -> campaign message already exists in conversation ${convId}`);
        summary.alreadySent++;
        continue;
      }

      const previewFirst = content.split('\n')[0];
      const status = profile.account_status && profile.account_status !== 'active' ? ` [account:${profile.account_status}]` : '';
      console.log(`${opts.execute ? 'SEND' : 'PLAN'}  ${r.email}  seg=${r.segment} lang=${lang} conv=${convAction}${convId ? `(${convId})` : ''}${status}`);
      if (!opts.direct) console.log(`      title: "${title}"`);
      console.log(`      "${previewFirst}"  (${content.length} chars, ${content.split('\n').length} lines)`);

      if (!opts.execute) continue;

      if (!convId) {
        convId = await createConversation(
          supabase, sender.id, participantIds, title, opts.direct ? 'direct' : 'group'
        );
        summary.created++;
        console.log(`      created conversation ${convId} with ${participantIds.length} participants`);
      } else {
        summary.reused++;
      }
      const msgId = await postMessage(supabase, convId, sender.id, content, r.segment, opts.campaign);
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
  console.log(`   no player (skipped)   : ${summary.skippedNoPlayer}`);
  console.log(`   errors                : ${summary.errors}`);
  if (!opts.execute) console.log('\n   DRY RUN: nothing was written. Re-run with --execute to send.');
  console.log('------------------------------------------------------------');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
