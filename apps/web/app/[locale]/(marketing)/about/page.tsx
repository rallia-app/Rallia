import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { defaultLocale, type Locale } from '@rallia/shared-translations';

import { TEAM } from './_data/team';

import { JsonLd, personJsonLd } from '@/components/json-ld';
import { buildPageMetadata } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/about', namespace: 'seo.about' });
}

export default async function AboutPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });

  const personSchemas = TEAM.map(m =>
    personJsonLd({
      slug: m.slug,
      name: m.name,
      jobTitle: m.jobTitle[locale] ?? m.jobTitle[defaultLocale],
      image: m.image,
      url: m.url,
      sameAs: m.sameAs,
    })
  );

  return (
    <div className="w-full max-w-3xl mx-auto py-12 px-4 flex flex-col gap-16">
      <JsonLd data={personSchemas} />

      {/* Hero */}
      <header className="flex flex-col gap-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold">{t('hero.heading')}</h1>
        <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          {t('hero.subheading')}
        </p>
      </header>

      {/* Mission */}
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl md:text-3xl font-bold">{t('mission.heading')}</h2>
        <p className="text-base md:text-lg leading-relaxed text-foreground">{t('mission.body1')}</p>
        <p className="text-base md:text-lg leading-relaxed text-foreground">{t('mission.body2')}</p>
      </section>

      {/* Story */}
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl md:text-3xl font-bold">{t('story.heading')}</h2>
        <p className="text-base md:text-lg leading-relaxed text-foreground">{t('story.body')}</p>
      </section>

      {/* Team */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl md:text-3xl font-bold">{t('team.heading')}</h2>
          <p className="text-base text-muted-foreground">{t('team.intro')}</p>
        </div>
        <ul className="flex flex-col gap-4 list-none p-0">
          {TEAM.map(m => (
            <li
              key={m.slug}
              className="flex flex-col gap-2 p-6 rounded-xl border border-border bg-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                <h3 className="text-xl font-semibold text-foreground">{m.name}</h3>
                <span className="text-sm font-medium text-primary">
                  {m.jobTitle[locale] ?? m.jobTitle[defaultLocale]}
                </span>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed">
                {m.bio[locale] ?? m.bio[defaultLocale]}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="flex flex-col gap-4 items-center text-center border-t border-border pt-12">
        <h2 className="text-2xl md:text-3xl font-bold">{t('cta.heading')}</h2>
        <p className="text-base text-muted-foreground max-w-xl">{t('cta.body')}</p>
      </section>
    </div>
  );
}
