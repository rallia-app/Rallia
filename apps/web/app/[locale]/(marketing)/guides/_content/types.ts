import type { Locale } from '@rallia/shared-translations';
import type { ReactNode } from 'react';

/** Shared meta — locale-independent. */
export interface GuideMeta {
  slug: string;
  /** ISO 8601 date string */
  publishedAt: string;
  /** ISO 8601 date string, optional */
  updatedAt?: string;
  /**
   * Sports the guide is relevant to. Used for cross-linking and breadcrumb hints.
   */
  sports: ReadonlyArray<'tennis' | 'pickleball'>;
  /**
   * Hero image shown on the article page, used for OG/Twitter cards and
   * referenced from the Article JSON-LD schema. Path must be absolute from
   * the site root (e.g. `/guides/foo.jpg`).
   */
  image: {
    src: string;
    width: number;
    height: number;
    /** Optional photographer credit; rendered as a small caption below the image. */
    credit?: {
      name?: string;
      url: string;
    };
  };
}

/** Locale-specific guide content. */
export interface GuideLocaleContent {
  /** SEO + browser tab title */
  title: string;
  /** SEO meta description (≤160 chars recommended) */
  description: string;
  /** Open Graph + Twitter title (often punchier than `title`) */
  ogTitle?: string;
  /** Open Graph + Twitter description */
  ogDescription?: string;
  /** Visible H1 on the page */
  heading: string;
  /**
   * The 40-60 word direct answer paragraph rendered immediately after H1.
   * This is the single biggest GEO citation lift per 2026 research.
   */
  leadAnswer: string;
  /** Localized alt text for the hero image (accessibility + image SEO). */
  imageAlt: string;
  /** Main article body. */
  body: ReactNode;
}

export interface Guide {
  meta: GuideMeta;
  content: Record<Locale, GuideLocaleContent>;
}
