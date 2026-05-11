import type { UtmParams } from './types';

const UTM_KEYS: ReadonlyArray<keyof UtmParams> = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

/**
 * Extracts UTM params from any URL-like string. Tolerates:
 * - full URLs (`https://rallia.app/play?utm_source=...`)
 * - custom schemes (`rallia://match/abc?utm_source=...`)
 * - bare query strings (`utm_source=...&utm_medium=...`)
 * - missing query (returns `null`)
 *
 * Returns `null` when no UTM keys are present so callers can early-exit.
 */
export function parseUtmParams(input: string | null | undefined): UtmParams | null {
  if (!input) return null;
  const queryIndex = input.indexOf('?');
  const query = queryIndex === -1 ? input : input.slice(queryIndex + 1);
  if (!query.includes('utm_')) return null;

  const params: UtmParams = {};
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    if (!isUtmKey(key)) continue;
    const rawValue = part.slice(eq + 1);
    if (!rawValue) continue;
    try {
      params[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // Skip malformed values rather than throwing — UTM tags are best-effort.
    }
  }
  return Object.keys(params).length > 0 ? params : null;
}

function isUtmKey(key: string): key is keyof UtmParams {
  return (UTM_KEYS as ReadonlyArray<string>).includes(key);
}
