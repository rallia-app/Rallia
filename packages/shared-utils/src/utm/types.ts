import type { UtmCampaign, UtmMedium, UtmSource } from './vocabulary';

/**
 * Shape used everywhere we read or write UTM params. Sources/mediums are
 * widened to `string` because inbound traffic from the wild may carry tags
 * we never minted ourselves — we still want to capture them.
 */
export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

/**
 * Strict version used by `buildUtmUrl` so we only ever *generate* tags from
 * the canonical vocabulary. Inbound parsing stays permissive (UtmParams).
 */
export interface UtmParamsStrict {
  utm_source: UtmSource;
  utm_medium: UtmMedium;
  utm_campaign: UtmCampaign;
  utm_content?: string;
  utm_term?: string;
}
