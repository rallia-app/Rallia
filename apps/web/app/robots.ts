import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/seo';

const DISALLOW_PRIVATE = [
  '/api/',
  '/monitoring/',
  '/ingest/',
  '/*/admin/',
  '/*/app/',
  '/*/dashboard/',
  '/*/onboarding/',
  '/*/sign-in',
  '/*/match/',
  '/*/player/',
  '/*/invite/',
  '/*/join/',
  '/*/match-invite/',
  '/*/community/join/',
];

// Link-preview crawlers that honour robots.txt. Under `*` they were refused both
// the share pages and the /api/og image, so Facebook posts rendered no card
// while WhatsApp (which ignores robots.txt) did. Nothing on a share page or an
// OG image is private; the auth-gated areas stay blocked.
const PREVIEW_CRAWLERS = ['facebookexternalhit', 'Twitterbot', 'LinkedInBot'] as const;
const DISALLOW_FOR_PREVIEWS = [
  '/monitoring/',
  '/ingest/',
  '/*/admin/',
  '/*/app/',
  '/*/dashboard/',
  '/*/onboarding/',
  '/*/sign-in',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...PREVIEW_CRAWLERS.map(bot => ({
        userAgent: bot,
        allow: ['/'],
        disallow: DISALLOW_FOR_PREVIEWS,
      })),
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW_PRIVATE,
      },
      // AI training crawlers — block to protect content from model training
      ...(
        [
          'GPTBot',
          'ClaudeBot',
          'CCBot',
          'Google-Extended',
          'Meta-ExternalAgent',
          'Bytespider',
          'anthropic-ai',
        ] as const
      ).map(bot => ({
        userAgent: bot,
        disallow: ['/'],
      })),
      // AI search / retrieval agents — allow so we appear in AI search results
      ...(
        [
          'OAI-SearchBot',
          'ChatGPT-User',
          'PerplexityBot',
          'Claude-User',
          'Claude-SearchBot',
        ] as const
      ).map(bot => ({
        userAgent: bot,
        allow: ['/'],
        disallow: DISALLOW_PRIVATE,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
