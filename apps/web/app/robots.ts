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
  '/*/digest/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
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
