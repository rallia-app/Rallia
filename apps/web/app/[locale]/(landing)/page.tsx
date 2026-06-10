import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import {
  ArrowRight,
  BookOpen,
  CalendarX,
  Download,
  Map,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Trophy,
  TrendingDown,
  Users,
  UserX,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { buildPageMetadata } from '@/lib/seo';
import { JsonLd, faqPageJsonLd } from '@/components/json-ld';
import { AppStoreButtons } from '@/components/app-store-buttons';
import { HeroDownloadCta } from '@/components/hero-download-cta';
import { Link } from '@/i18n/navigation';
import { ScrollReveal } from '@/components/scroll-reveal';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '', namespace: 'seo.landing' });
}

const FAQ_KEYS = ['cost', 'sports', 'matching', 'privacy', 'getStarted', 'platforms'] as const;

export default async function Home({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  const faqItems = FAQ_KEYS.map(key => ({
    question: t(`landing.faq.questions.${key}.question`),
    answer: t(`landing.faq.questions.${key}.answer`),
  }));

  return (
    <>
      <JsonLd data={faqPageJsonLd(faqItems)} />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* ====== HERO — Full viewport video ====== */}
      <section className="relative flex items-center justify-center w-full min-h-[100svh] overflow-hidden animate-fade-in">
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/video/hero-poster.jpg"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/video/hero.webm" type="video/webm" />
          <source src="/video/hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/55" />
        <div className="relative z-10 flex flex-col items-center text-center gap-6 px-8 pt-36 pb-24 max-w-5xl mx-auto">
          <h1 className="text-5xl md:text-8xl font-bold text-white">
            {t('landing.hero.headline')}
          </h1>
          <h2 className="text-xl md:text-2xl text-white/60 max-w-2xl -mt-8">
            {t('landing.hero.subheadline')}
          </h2>
          <div className="mt-6 md:hidden">
            <AppStoreButtons badgeHeight={48} />
          </div>
          <div className="hidden md:block mt-6">
            <HeroDownloadCta label={t('landing.hero.downloadButton')} />
          </div>
          <a
            href="#how-it-works"
            className="text-sm text-white/50 hover:text-white transition-colors mt-2"
          >
            {t('landing.hero.learnMore')} ↓
          </a>
        </div>
      </section>

      {/* ====== LEAD ANSWER — front-loaded for GEO/AI citation ====== */}
      <section
        id="main-content"
        className="w-full bg-background border-y border-border"
        aria-labelledby="lead-answer-heading"
      >
        <div className="max-w-3xl mx-auto px-8 py-16 md:py-20 flex flex-col items-center text-center gap-6">
          <h2 id="lead-answer-heading" className="text-3xl md:text-4xl font-bold text-foreground">
            {t('landing.leadAnswer.headline')}
          </h2>
          <p className="text-lg md:text-xl leading-relaxed text-muted-foreground">
            {t('landing.leadAnswer.body')}
          </p>
        </div>
      </section>

      {/* ====== PROBLEMS — Dark teal background, glowing cards ====== */}
      <section className="w-full bg-[var(--primary-950)] dark:bg-[#0b1a18]">
        <div className="flex flex-col items-center justify-center gap-12 min-h-[100svh] max-w-6xl mx-auto px-8 py-24">
          <div className="flex flex-col items-center gap-4">
            <Badge className="text-base px-4 py-1 bg-[var(--secondary-500)] text-white">
              {t('problems.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              {t('problems.sectionTitle')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
            {(
              [
                { key: 'scheduling', icon: CalendarX },
                { key: 'compatibility', icon: Users },
                { key: 'reliability', icon: UserX },
                { key: 'growth', icon: TrendingDown },
              ] as const
            ).map(({ key, icon: Icon }) => (
              <ScrollReveal key={key}>
                <Card className="bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 hover:-translate-y-1">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-[#ed6a6d]/20">
                        <Icon className="size-6 text-[#f1888a]" />
                      </div>
                      <CardTitle className="text-xl text-white">
                        {t(`problems.${key}.title`)}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base text-white/60">
                      {t(`problems.${key}.description`)}
                    </CardDescription>
                  </CardContent>
                </Card>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ====== SOLUTIONS — Light, alternating left-right ====== */}
      <section className="w-full bg-[var(--primary-50)] dark:bg-[#0a0f0e]">
        <div className="flex flex-col items-center justify-center gap-16 min-h-[100svh] max-w-6xl mx-auto px-8 py-24">
          <div className="flex flex-col items-center gap-4">
            <Badge className="text-base px-4 py-1 bg-[var(--primary-500)] text-white">
              {t('landing.solutions.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold">
              {t('landing.solutions.sectionTitle')}
            </h2>
          </div>

          <div className="flex flex-col gap-20 w-full">
            {(
              [
                { key: 'courtFinder', icon: Map },
                { key: 'skillLevels', icon: ShieldCheck },
                { key: 'gameMarketplace', icon: ShoppingCart },
                { key: 'reputation', icon: Trophy },
              ] as const
            ).map(({ key, icon: Icon }, i) => (
              <div
                key={key}
                className={`flex flex-col md:flex-row items-center gap-8 md:gap-16 ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
              >
                <div className="flex-shrink-0 size-24 md:size-32 rounded-2xl bg-[var(--primary-100)] dark:bg-[var(--primary-500)]/10 flex items-center justify-center">
                  <Icon className="size-12 md:size-16 text-[var(--primary-600)] dark:text-[var(--primary-500)]" />
                </div>
                <div className="flex flex-col gap-3 text-center md:text-left">
                  <h3 className="text-2xl md:text-3xl font-bold">
                    {t(`landing.solutions.${key}.title`)}
                  </h3>
                  <p className="text-lg text-muted-foreground max-w-lg">
                    {t(`landing.solutions.${key}.description`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== EXPLORE — Link out to Games / Communities / Guides ====== */}
      <section className="w-full bg-[var(--primary-100)] dark:bg-[#0c1413]">
        <div className="flex flex-col items-center justify-center gap-12 max-w-6xl mx-auto px-8 py-24">
          <div className="flex flex-col items-center gap-4">
            <Badge className="text-base px-4 py-1 bg-[var(--primary-500)] text-white">
              {t('landing.explore.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-center">
              {t('landing.explore.sectionTitle')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
            {(
              [
                { key: 'games', href: '/games', icon: ShoppingCart },
                { key: 'communities', href: '/communities', icon: Users },
                { key: 'guides', href: '/guides', icon: BookOpen },
              ] as const
            ).map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                className="group flex flex-col gap-4 p-8 rounded-2xl bg-white dark:bg-white/5 border border-transparent hover:border-[var(--primary-500)]/40 shadow-sm hover:shadow-md transition-all hover:-translate-y-1"
              >
                <div className="size-12 rounded-xl bg-[var(--primary-100)] dark:bg-[var(--primary-500)]/10 flex items-center justify-center">
                  <Icon className="size-6 text-[var(--primary-600)] dark:text-[var(--primary-500)]" />
                </div>
                <h3 className="text-2xl font-bold">{t(`landing.explore.${key}.title`)}</h3>
                <p className="text-base text-muted-foreground flex-1">
                  {t(`landing.explore.${key}.description`)}
                </p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary-600)] dark:text-[var(--primary-500)] group-hover:gap-2 transition-all">
                  {t(`landing.explore.${key}.cta`)}
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS — Dark teal, timeline stepper ====== */}
      <section id="how-it-works" className="w-full bg-[var(--primary-900)] dark:bg-[#071412]">
        <div className="flex flex-col items-center justify-center gap-16 min-h-[100svh] max-w-5xl mx-auto px-8 py-24">
          <div className="flex flex-col items-center gap-4">
            <Badge className="text-base px-4 py-1 bg-[var(--primary-500)] text-white">
              {t('landing.howItWorks.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              {t('landing.howItWorks.sectionTitle')}
            </h2>
          </div>

          <div className="relative flex flex-col md:flex-row gap-8 md:gap-0 w-full">
            {/* Connecting line (desktop) */}
            <div className="hidden md:block absolute top-8 left-[10%] right-[10%] h-0.5 bg-[var(--primary-500)]/30" />

            {[1, 2, 3, 4].map(step => {
              const icons = [Download, Users, Sparkles, Star];
              const Icon = icons[step - 1];
              return (
                <div
                  key={step}
                  className="flex-1 flex flex-col items-center text-center gap-4 relative"
                >
                  <div className="relative z-10 size-16 rounded-full bg-[var(--primary-500)] flex items-center justify-center shadow-lg shadow-[var(--primary-500)]/25">
                    <Icon className="size-7 text-white" />
                  </div>
                  <span className="text-sm font-bold text-white/40 uppercase tracking-wider">
                    {`0${step}`}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {t(`landing.howItWorks.step${step}.title`)}
                  </h3>
                  <p className="text-sm text-white/60 max-w-[200px]">
                    {t(`landing.howItWorks.step${step}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ====== DOWNLOAD CTA + FAQ ====== */}
      <section className="w-full bg-[var(--primary-50)] dark:bg-[#0a0f0e]">
        <div className="flex flex-col items-center gap-24 max-w-6xl mx-auto px-8 py-24">
          {/* Download CTA */}
          <div
            id="download"
            className="flex flex-col items-center text-center gap-8 cta-gradient py-16 px-8 rounded-2xl w-full shadow-luma"
          >
            <div className="flex flex-col gap-4 max-w-2xl">
              <h2 className="text-4xl md:text-5xl font-bold">
                {t('landing.downloadCta.headline')}
              </h2>
              <p className="text-lg text-muted-foreground m-0">
                {t('landing.downloadCta.description')}
              </p>
            </div>
            <div className="md:hidden">
              <AppStoreButtons badgeHeight={48} />
            </div>
            <div className="hidden md:block">
              <HeroDownloadCta label={t('landing.hero.downloadButton')} />
            </div>
          </div>

          {/* FAQ */}
          <div className="flex flex-col items-center w-full gap-12">
            <div className="flex flex-col items-center gap-4">
              <Badge className="text-base px-4 py-1 bg-[var(--primary-500)] text-white">
                {t('landing.faq.sectionBadge')}
              </Badge>
              <h2 className="text-4xl md:text-5xl font-bold text-center">
                {t('landing.faq.sectionTitle')}
              </h2>
            </div>

            <Card className="w-full">
              <CardContent className="pt-6">
                <Accordion type="single" collapsible className="w-full">
                  {['cost', 'sports', 'matching', 'privacy', 'getStarted', 'platforms'].map(key => (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger className="text-left">
                        {t(`landing.faq.questions.${key}.question`)}
                      </AccordionTrigger>
                      <AccordionContent>
                        {t(`landing.faq.questions.${key}.answer`)}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
