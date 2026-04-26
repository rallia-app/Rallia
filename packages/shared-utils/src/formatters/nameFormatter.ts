interface NameFields {
  first_name?: string | null;
  last_name?: string | null;
  // display_name is intentionally ignored — we always render first (+ last).
  display_name?: string | null;
}

/**
 * Full human name: first_name (+ last_name) -> fallback.
 * Use for profile headers, admin tables, and anywhere a person's real name is shown.
 * Never falls back to display_name.
 */
export function getHumanName(profile: NameFields | null | undefined, fallback = 'Player'): string {
  if (!profile) return fallback;
  const first = profile.first_name?.trim();
  const last = profile.last_name?.trim();
  if (first) {
    return last ? `${first} ${last}` : first;
  }
  return fallback;
}

/**
 * Short name: first_name -> fallback.
 * Use for compact UI (chat bubbles, match cards, player lists).
 * Never falls back to display_name.
 */
export function getShortName(profile: NameFields | null | undefined, fallback = 'Player'): string {
  if (!profile) return fallback;
  return profile.first_name?.trim() || fallback;
}
