/**
 * Unified Invitation Link Service
 *
 * Single source of truth for generating and parsing all invitation deep links.
 * All invitation types route through /invite/{referralCode} with query params
 * for the invitation context (type, target ID, share token).
 */

// ============================================================================
// TYPES
// ============================================================================

export type InvitationType = 'referral' | 'match' | 'group' | 'community';

export interface InvitationLinkParams {
  type: InvitationType;
  referralCode: string;
  /** The entity ID: matchId, groupInviteCode, communityInviteCode */
  targetId?: string;
  /** Optional per-recipient match share token for contact-based tracking */
  shareToken?: string;
}

export interface ParsedInvitationLink {
  referralCode: string;
  type: InvitationType;
  targetId?: string;
  shareToken?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASE_URL =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WEB_URL
    ? process.env.EXPO_PUBLIC_WEB_URL
    : typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_URL
      ? process.env.NEXT_PUBLIC_APP_URL
      : 'https://rallia.app';

/** Regex to strip locale prefixes from URLs (e.g. /en-US/, /fr-CA/) */
const LOCALE_PREFIX = /^\/(en|en-US|fr|fr-CA|fr-FR)\//;

// ============================================================================
// LINK GENERATION
// ============================================================================

/**
 * Generate a unified invitation link.
 *
 * Examples:
 *   generateInvitationLink({ type: 'referral', referralCode: 'ABCD1234' })
 *     → https://rallia.app/invite/ABCD1234
 *
 *   generateInvitationLink({ type: 'match', referralCode: 'ABCD1234', targetId: 'uuid' })
 *     → https://rallia.app/invite/ABCD1234?type=match&id=uuid
 *
 *   generateInvitationLink({ type: 'match', referralCode: 'ABCD1234', targetId: 'uuid', shareToken: 'tok' })
 *     → https://rallia.app/invite/ABCD1234?type=match&id=uuid&share=tok
 */
export function generateInvitationLink(params: InvitationLinkParams): string {
  const { type, referralCode, targetId, shareToken } = params;
  const base = `${BASE_URL}/invite/${encodeURIComponent(referralCode)}`;

  if (type === 'referral' && !targetId && !shareToken) {
    return base;
  }

  const searchParams = new URLSearchParams();
  if (type !== 'referral') {
    searchParams.set('type', type);
  }
  if (targetId) {
    searchParams.set('id', targetId);
  }
  if (shareToken) {
    searchParams.set('share', shareToken);
  }

  const qs = searchParams.toString();
  return qs ? `${base}?${qs}` : base;
}

// ============================================================================
// LINK PARSING
// ============================================================================

/**
 * Parse any invitation URL into structured data.
 * Handles the unified format and strips locale prefixes.
 *
 * Supported formats:
 *   /invite/{code}
 *   /invite/{code}?type=match&id=uuid
 *   /invite/{code}?type=match&id=uuid&share=token
 *   /en/invite/{code}?type=group&id=code    (locale-prefixed)
 *   rallia://invite/{code}?type=community&id=code
 *
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parseInvitationUrl(url: string): ParsedInvitationLink | null {
  try {
    let parsed: URL;

    // Handle custom scheme (rallia://)
    if (url.startsWith('rallia://')) {
      parsed = new URL(url.replace('rallia://', 'https://rallia.app/'));
    } else if (url.startsWith('/')) {
      parsed = new URL(url, 'https://rallia.app');
    } else {
      parsed = new URL(url);
    }

    // Strip locale prefix from pathname
    let pathname = parsed.pathname.replace(LOCALE_PREFIX, '/');

    // Match /invite/{code}
    const match = pathname.match(/^\/invite\/([^/?]+)/);
    if (!match) return null;

    const referralCode = decodeURIComponent(match[1]);
    const typeParam = parsed.searchParams.get('type');
    const targetId = parsed.searchParams.get('id') ?? undefined;
    const shareToken = parsed.searchParams.get('share') ?? undefined;

    const type: InvitationType =
      typeParam && ['match', 'group', 'community', 'referral'].includes(typeParam)
        ? (typeParam as InvitationType)
        : 'referral';

    return { referralCode, type, targetId, shareToken };
  } catch {
    return null;
  }
}
