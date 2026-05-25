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
      'en-US': 'Co-founder',
      'fr-CA': 'Cofondateur',
    },
    bio: {
      'en-US':
        'Co-founder of Rallia. Tennis and pickleball player tired of the status quo of chasing partners through group chats. Based in Montréal.',
      'fr-CA':
        'Cofondateur de Rallia. Joueur de tennis et de pickleball fatigué du statu quo de courir après ses partenaires dans des groupes de discussion. Basé à Montréal.',
    },
  },
  {
    slug: 'jean-de-laure-sonkin',
    name: 'Jean de Laure Sonkin',
    jobTitle: {
      'en-US': 'Co-founder',
      'fr-CA': 'Cofondateur',
    },
    bio: {
      'en-US':
        'Co-founder of Rallia. Tennis player who shared the same frustration with the status quo and joined to build a better way.',
      'fr-CA':
        'Cofondateur de Rallia. Joueur de tennis qui partageait la même frustration face au statu quo et s’est joint au projet pour bâtir une meilleure façon de faire.',
    },
  },
];
