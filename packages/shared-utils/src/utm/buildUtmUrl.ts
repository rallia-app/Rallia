import type { UtmParams, UtmParamsStrict } from './types';

/**
 * Append UTM params to a URL. Existing UTM params on `baseUrl` are *replaced*
 * (last write wins), so it's safe to re-tag a URL that already carries tags.
 * Other query params are preserved.
 *
 * Use the strict overload anywhere we generate a link from app code — it
 * forces use of the canonical vocabulary in `vocabulary.ts`.
 */
export function buildUtmUrl(baseUrl: string, params: UtmParamsStrict): string;
export function buildUtmUrl(baseUrl: string, params: UtmParams): string;
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  // URL needs an absolute base. Detect schemeless input and rebuild after.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl);
  const url = new URL(baseUrl, isAbsolute ? undefined : 'https://placeholder.invalid');

  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, value);
  }

  if (isAbsolute) return url.toString();
  // Strip the placeholder origin we added so relative URLs stay relative.
  return `${url.pathname}${url.search}${url.hash}`;
}
