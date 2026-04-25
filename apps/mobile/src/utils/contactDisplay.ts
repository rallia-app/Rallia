/**
 * Shared display helpers for contact rows across the app.
 *
 * Used by every surface that renders a contact list (device contacts,
 * shared-list contacts, opponent picker, etc.) so avatars and subtitles look
 * identical everywhere.
 */

const AVATAR_PALETTE = [
  '#F97316', // orange-500
  '#EAB308', // yellow-500
  '#22C55E', // green-500
  '#06B6D4', // cyan-500
  '#3B82F6', // blue-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#EF4444', // red-500
];

export function getContactInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function getAvatarColor(seed: string | null | undefined): string {
  const s = seed ?? '';
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function formatContactSubtitle(
  phone: string | null | undefined,
  email: string | null | undefined
): string {
  if (phone) return phone.replace(/\s+/g, ' ').trim();
  return email ?? '';
}
