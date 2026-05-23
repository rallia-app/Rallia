import type { Locale } from '@rallia/shared-translations';

export interface TeamMember {
  /** Used as the JSON-LD @id fragment and the React key. Lowercase, hyphenated. */
  slug: string;
  /** Display name */
  name: string;
  /** Job title — same key in both locales, value differs. */
  jobTitle: Record<Locale, string>;
  /** 1-3 sentence bio, plain text, localized. */
  bio: Record<Locale, string>;
  /** Optional headshot path under /public (e.g. `/team/mathis.jpg`). */
  image?: string;
  /** Optional canonical profile link (LinkedIn, personal site). */
  url?: string;
  /** Optional same-as links (LinkedIn, X, etc.) for entity disambiguation. */
  sameAs?: string[];
}

/**
 * Add a new team member by appending another object to this array.
 * Order roughly controls render order (founders first).
 */
export const TEAM: ReadonlyArray<TeamMember> = [
  {
    slug: 'mathis-lefranc',
    name: 'Mathis Lefranc',
    jobTitle: {
      'en-US': 'Founder',
      'fr-CA': 'Fondateur',
    },
    bio: {
      'en-US':
        'Founder of Rallia. Tennis and pickleball player who got tired of chasing partners through group chats and built the app he wanted to use. Based in Montréal.',
      'fr-CA':
        'Fondateur de Rallia. Joueur de tennis et de pickleball fatigué de courir après ses partenaires dans des groupes de discussion — il a construit l’application qu’il voulait utiliser. Basé à Montréal.',
    },
  },
];
