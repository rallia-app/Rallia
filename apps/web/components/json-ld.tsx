import { SITE_NAME, SITE_URL } from '@/lib/seo';

type JsonLdValue = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLdValue | JsonLdValue[] }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/id6760482014';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';

export const organizationJsonLd: JsonLdValue = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/logo-light.png`,
  sameAs: [APP_STORE_URL, PLAY_STORE_URL],
};

export const websiteJsonLd: JsonLdValue = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: ['en-US', 'fr-CA'],
  publisher: { '@id': `${SITE_URL}/#organization` },
};

export const mobileApplicationJsonLd: JsonLdValue[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    '@id': `${SITE_URL}/#ios-app`,
    name: SITE_NAME,
    operatingSystem: 'iOS 16+',
    applicationCategory: 'SportsApplication',
    url: APP_STORE_URL,
    downloadUrl: APP_STORE_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': `${SITE_URL}/#organization` },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    '@id': `${SITE_URL}/#android-app`,
    name: SITE_NAME,
    operatingSystem: 'Android 10+',
    applicationCategory: 'SportsApplication',
    url: PLAY_STORE_URL,
    downloadUrl: PLAY_STORE_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': `${SITE_URL}/#organization` },
  },
];

export interface PersonInput {
  /** Stable identifier used for cross-schema linking (e.g., 'mathis-lefranc'). */
  slug: string;
  name: string;
  jobTitle: string;
  /** Optional headshot URL */
  image?: string;
  /** Optional profile URL (LinkedIn, personal site, etc.) */
  url?: string;
  /** Optional sameAs links (LinkedIn, X, etc.) for entity disambiguation. */
  sameAs?: string[];
}

export function personJsonLd(input: PersonInput): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${SITE_URL}/about#${input.slug}`,
    name: input.name,
    jobTitle: input.jobTitle,
    worksFor: { '@id': `${SITE_URL}/#organization` },
    ...(input.image && { image: input.image }),
    ...(input.url && { url: input.url }),
    ...(input.sameAs && input.sameAs.length > 0 && { sameAs: input.sameAs }),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface ArticleInput {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  inLanguage: string;
  image?: string;
}

export function articleJsonLd(input: ArticleInput): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    datePublished: input.datePublished,
    ...(input.dateModified && { dateModified: input.dateModified }),
    inLanguage: input.inLanguage,
    ...(input.image && { image: input.image }),
    url: input.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function faqPageJsonLd(questions: { question: string; answer: string }[]): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(q => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  };
}

export interface SportsEventInput {
  name: string;
  sportName: string;
  startDate: string;
  endDate?: string;
  locationName: string;
  locationCity?: string;
  latitude?: number | null;
  longitude?: number | null;
  url?: string;
}

export function sportsEventJsonLd(event: SportsEventInput): JsonLdValue {
  const location: JsonLdValue = {
    '@type': 'SportsActivityLocation',
    name: event.locationName,
    ...(event.locationCity && {
      address: { '@type': 'PostalAddress', addressLocality: event.locationCity },
    }),
    ...(event.latitude != null &&
      event.longitude != null && {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: event.latitude,
          longitude: event.longitude,
        },
      }),
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    sport: event.sportName,
    startDate: event.startDate,
    ...(event.endDate && { endDate: event.endDate }),
    location,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    organizer: { '@id': `${SITE_URL}/#organization` },
    ...(event.url && { url: event.url }),
  };
}
