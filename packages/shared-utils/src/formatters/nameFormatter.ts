interface NameFields {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
}

/**
 * Full human name: first_name (+ last_name) -> display_name -> fallback.
 * Use for profile headers, admin tables, and anywhere a person's real name is shown.
 */
export function getHumanName(profile: NameFields | null | undefined, fallback = 'Player'): string {
  if (!profile) return fallback;
  const first = profile.first_name?.trim();
  const last = profile.last_name?.trim();
  if (first) {
    return last ? `${first} ${last}` : first;
  }
  return profile.display_name?.trim() || fallback;
}

/**
 * Short name: first_name -> display_name -> fallback.
 * Use for compact UI (chat bubbles, match cards, player lists).
 */
export function getShortName(profile: NameFields | null | undefined, fallback = 'Player'): string {
  if (!profile) return fallback;
  return profile.first_name?.trim() || profile.display_name?.trim() || fallback;
}
