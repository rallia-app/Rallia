/**
 * Rallia link parsing for in-app surfaces (QR scans, chat messages).
 *
 * Host-checks before delegating to parseInvitationUrl, which accepts any host
 * and would happily resolve https://evil.com/community/join/{code}.
 */

import { parseInvitationUrl } from '@rallia/shared-services';

export type RalliaLinkTarget =
  | { kind: 'invite-code'; code: string }
  | { kind: 'match'; matchId: string }
  | null;

const RAW_CODE_RE = /^[A-Z0-9]{8}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_HOSTS = new Set(['rallia.app', 'www.rallia.app']);

/**
 * Resolve a raw string (URL or bare invite code) to an in-app target.
 * Returns null for anything we should not handle in-app.
 */
export function parseRalliaLink(raw: string): RalliaLinkTarget {
  const trimmed = raw.trim();

  let isLikelyUrl = false;
  try {
    const url = new URL(trimmed);
    isLikelyUrl = true;
    if (!ALLOWED_HOSTS.has(url.host)) return null;
  } catch {
    // Not a URL — fall through
  }

  if (isLikelyUrl) {
    const parsed = parseInvitationUrl(trimmed);
    if (!parsed) return null;

    if (parsed.type === 'match' && parsed.targetId && UUID_RE.test(parsed.targetId)) {
      return { kind: 'match', matchId: parsed.targetId.toLowerCase() };
    }

    if ((parsed.type === 'group' || parsed.type === 'community') && parsed.targetId) {
      const code = parsed.targetId.toUpperCase();
      if (RAW_CODE_RE.test(code)) {
        return { kind: 'invite-code', code };
      }
    }

    return null;
  }

  if (RAW_CODE_RE.test(trimmed)) {
    return { kind: 'invite-code', code: trimmed.toUpperCase() };
  }

  return null;
}
