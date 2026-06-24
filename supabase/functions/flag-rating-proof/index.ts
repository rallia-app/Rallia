/**
 * flag-rating-proof
 *
 * LLM vision triage for uploaded rating proofs. Called by a DB trigger on
 * rating_proof INSERT / file-replace (see migration 20260624090000).
 *
 * This is a NEGATIVE triage filter, not a verifier: it flags media that clearly
 * is not a plausible rating proof (selfies, memes, blank images, unrelated app
 * screenshots). It never changes `status` — a human still approves/rejects.
 *
 * Scope: images and PDF documents. Videos, non-PDF documents, and external
 * links are marked `skipped` for manual review.
 */

import { encodeBase64 } from '@std/encoding/base64';
import { createClient } from '@supabase/supabase-js';

import { requireSecretApikey } from '../_shared/auth.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Haiku 4.5 is plenty for binary-ish triage and ~$2.50 / 1000 images.
const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are a moderation triage assistant for a tennis & pickleball app.
Players upload "rating proofs" — media that backs up their self-declared skill rating.
A valid proof looks like a screenshot or photo of a recognized rating source: a UTR,
DUPR, NTRP, or WTN profile/screenshot, a tournament result or draw, a league standing,
a federation/club ranking, or a coach's written attestation.

Your ONLY job is to decide whether the uploaded media (an image or a PDF document)
PLAUSIBLY could be such a proof — not to verify the rating is correct or belongs to the
uploader. Be lenient: when it could reasonably be a rating proof, mark it plausible.
Only mark it implausible when it
clearly is NOT one — e.g. a selfie, a random photo, a meme, a blank/black image, food,
a screenshot of an unrelated app, or pure spam.`;

const ASSESSMENT_TOOL = {
  name: 'record_assessment',
  description: 'Record the triage verdict for the uploaded image.',
  input_schema: {
    type: 'object',
    properties: {
      is_plausible_proof: {
        type: 'boolean',
        description: 'True if the image could plausibly be a tennis/pickleball rating proof.',
      },
      media_kind: {
        type: 'string',
        description:
          "Short snake_case label for what the image actually is, e.g. 'utr_screenshot', 'dupr_screenshot', 'tournament_result', 'coach_note', 'selfie', 'meme', 'unrelated_app', 'blank', 'other'.",
      },
      confidence: {
        type: 'number',
        description: 'Confidence in the verdict, 0 to 1.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence explaining the verdict.',
      },
    },
    required: ['is_plausible_proof', 'media_kind', 'confidence', 'reason'],
    additionalProperties: false,
  },
};

type Assessment = {
  is_plausible_proof: boolean;
  media_kind: string;
  confidence: number;
  reason: string;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type FlagFields = {
  auto_flag_status: 'plausible' | 'implausible' | 'skipped' | 'error';
  auto_flag_reason?: string | null;
  auto_flag_confidence?: number | null;
  auto_flag_media_kind?: string | null;
};

async function writeFlag(proofId: string, fields: FlagFields) {
  const { error } = await supabase
    .from('rating_proof')
    .update({
      auto_flag_status: fields.auto_flag_status,
      auto_flag_reason: fields.auto_flag_reason ?? null,
      auto_flag_confidence: fields.auto_flag_confidence ?? null,
      auto_flag_media_kind: fields.auto_flag_media_kind ?? null,
      auto_flag_model: MODEL,
      auto_flagged_at: new Date().toISOString(),
    })
    .eq('id', proofId);

  if (error) {
    console.error(`[flag-rating-proof] failed to write flag for ${proofId}: ${error.message}`);
  }
}

// Anthropic image cap is ~5MB of base64; PDF cap is ~32MB per request. Keep the
// raw bytes under these so the encoded payload stays within the limit; larger
// files fall back to URL source (Anthropic resizes / fetches them itself).
const MAX_IMAGE_BYTES = 4_500_000;
const MAX_PDF_BYTES = 22_000_000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

type MediaBlock =
  | { type: 'image' | 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'image' | 'document'; source: { type: 'url'; url: string } };

// Prefer downloading the file and sending it inline (base64) so the assessment
// doesn't depend on Anthropic's fetcher being able to reach the storage host
// (some CDNs block automated fetchers) and works even for private buckets.
// Fall back to URL source for oversized files, letting Anthropic fetch/resize.
async function buildMediaBlock(
  url: string,
  blockType: 'image' | 'document',
  mediaType: string,
  maxInlineBytes: number
): Promise<MediaBlock> {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength <= maxInlineBytes) {
        return {
          type: blockType,
          source: { type: 'base64', media_type: mediaType, data: encodeBase64(bytes) },
        };
      }
    }
  } catch (e) {
    console.warn(`[flag-rating-proof] inline fetch failed, using URL source: ${String(e)}`);
  }
  return { type: blockType, source: { type: 'url', url } };
}

async function assessMedia(mediaBlock: MediaBlock): Promise<Assessment> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [ASSESSMENT_TOOL],
      tool_choice: { type: 'tool', name: 'record_assessment' },
      messages: [
        {
          role: 'user',
          content: [mediaBlock, { type: 'text', text: 'Assess this uploaded rating proof.' }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const toolUse = (data.content ?? []).find(
    (b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'record_assessment'
  );
  if (!toolUse) {
    throw new Error('Anthropic response had no record_assessment tool_use block');
  }
  return toolUse.input as Assessment;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, apikey, Authorization',
      },
    });
  }

  const authError = requireSecretApikey(req);
  if (authError) return authError;

  let proofId: string | undefined;

  try {
    const body = await req.json();
    proofId = body.proof_id;
    if (!proofId) {
      return jsonResponse({ error: 'proof_id is required' }, 400);
    }

    const { data: proof, error } = await supabase
      .from('rating_proof')
      .select('id, proof_type, file:file_id ( url, file_type, mime_type )')
      .eq('id', proofId)
      .single();

    if (error || !proof) {
      throw new Error(error?.message ?? 'proof not found');
    }

    // file:file_id is a to-one embed; supabase-js may type it as an array.
    const file = Array.isArray(proof.file) ? proof.file[0] : proof.file;

    const mime = (file?.mime_type ?? '').toLowerCase();
    let block: MediaBlock | null = null;
    if (proof.proof_type === 'file' && file?.url) {
      if (file.file_type === 'image' && ALLOWED_IMAGE_TYPES.includes(mime)) {
        block = await buildMediaBlock(file.url, 'image', mime, MAX_IMAGE_BYTES);
      } else if (file.file_type === 'document' && mime === 'application/pdf') {
        block = await buildMediaBlock(file.url, 'document', 'application/pdf', MAX_PDF_BYTES);
      }
    }

    // Videos, non-PDF documents, HEIC images, and external links -> manual review.
    if (!block) {
      await writeFlag(proofId, {
        auto_flag_status: 'skipped',
        auto_flag_reason: 'Unsupported proof type for auto-check — needs manual review',
      });
      return jsonResponse({ proof_id: proofId, status: 'skipped' });
    }

    const assessment = await assessMedia(block);
    const status = assessment.is_plausible_proof ? 'plausible' : 'implausible';

    await writeFlag(proofId, {
      auto_flag_status: status,
      auto_flag_reason: String(assessment.reason ?? '').slice(0, 500),
      auto_flag_confidence: Math.max(0, Math.min(1, Number(assessment.confidence) || 0)),
      auto_flag_media_kind: String(assessment.media_kind ?? '').slice(0, 100),
    });

    console.log(
      `[flag-rating-proof] ${proofId} -> ${status} (${assessment.media_kind}, ${assessment.confidence})`
    );
    return jsonResponse({ proof_id: proofId, status });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error(`[flag-rating-proof] Error: ${message}`);
    if (proofId) {
      // Mark as error so the proof is visibly re-runnable, never silently stuck.
      await writeFlag(proofId, {
        auto_flag_status: 'error',
        auto_flag_reason: message.slice(0, 500),
      }).catch(() => {});
    }
    return jsonResponse({ error: message }, 500);
  }
});
