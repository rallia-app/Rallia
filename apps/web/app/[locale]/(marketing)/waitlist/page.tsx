import { ScrollReveal } from '@/components/scroll-reveal';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { WaitlistForm } from '@/components/waitlist-form';
import {
  CalendarX,
  Clock,
  Network,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  Users,
  UserX,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Rallia - Waitlist (Archived)',
  robots: { index: false, follow: false },
};

export default async function WaitlistPage() {
  const t = await getTranslations('home');

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="flex flex-col items-center w-full gap-24 pb-16" id="main-content">
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center gap-6 animate-fade-in hero-gradient rounded-3xl p-12 shadow-luma-lg">
          <Badge className="badge-interactive text-sm px-4 py-1.5 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white">
            {t('hero.badge')}
          </Badge>
          <h1 className="text-6xl md:text-8xl font-bold mt-8 mb-4">{t('hero.headline')}</h1>
          <h2 className="text-xl md:text-2xl text-muted-foreground max-w-2xl mt-8">
            {t('hero.subheadline')}
          </h2>
          <Button
            size="lg"
            className="cta-button mt-4 text-lg px-8 py-6 bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white"
            asChild
          >
            <a href="#waitlist">{t('hero.ctaButton')}</a>
          </Button>
          <p className="text-sm text-muted-foreground m-0">{t('hero.ctaSubtext')}</p>
        </section>

        {/* Problems Section */}
        <section className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-200">
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white">
              {t('problems.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold">{t('problems.sectionTitle')}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
            <ScrollReveal>
              <Card className="border-[var(--secondary-200)] dark:border-[var(--secondary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--secondary-300)] dark:hover:border-[var(--secondary-700)]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)]">
                      <CalendarX className="size-6 text-[var(--secondary-700)] dark:text-[var(--secondary-300)]" />
                    </div>
                    <CardTitle className="text-xl">{t('problems.scheduling.title')}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {t('problems.scheduling.description')}
                  </CardDescription>
                </CardContent>
              </Card>
            </ScrollReveal>

            <ScrollReveal>
              <Card className="border-[var(--secondary-200)] dark:border-[var(--secondary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--secondary-300)] dark:hover:border-[var(--secondary-700)]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)]">
                      <Users className="size-6 text-[var(--secondary-700)] dark:text-[var(--secondary-300)]" />
                    </div>
                    <CardTitle className="text-xl">{t('problems.compatibility.title')}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {t('problems.compatibility.description')}
                  </CardDescription>
                </CardContent>
              </Card>
            </ScrollReveal>

            <ScrollReveal>
              <Card className="border-[var(--secondary-200)] dark:border-[var(--secondary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--secondary-300)] dark:hover:border-[var(--secondary-700)]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)]">
                      <UserX className="size-6 text-[var(--secondary-700)] dark:text-[var(--secondary-300)]" />
                    </div>
                    <CardTitle className="text-xl">{t('problems.reliability.title')}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {t('problems.reliability.description')}
                  </CardDescription>
                </CardContent>
              </Card>
            </ScrollReveal>

            <ScrollReveal>
              <Card className="border-[var(--secondary-200)] dark:border-[var(--secondary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--secondary-300)] dark:hover:border-[var(--secondary-700)]">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)]">
                      <TrendingDown className="size-6 text-[var(--secondary-700)] dark:text-[var(--secondary-300)]" />
                    </div>
                    <CardTitle className="text-xl">{t('problems.growth.title')}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {t('problems.growth.description')}
                  </CardDescription>
                </CardContent>
              </Card>
            </ScrollReveal>
          </div>
        </section>

        <Separator className="max-w-md" />

        {/* Solutions Section */}
        <section className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-400">
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white">
              {t('solutions.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold">{t('solutions.sectionTitle')}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
            <Card className="border-[var(--primary-200)] dark:border-[var(--primary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-700)]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--primary-100)] dark:bg-[var(--primary-800)]">
                    <Sparkles className="size-6 text-[var(--primary-800)] dark:text-[var(--primary-200)]" />
                  </div>
                  <CardTitle className="text-xl">{t('solutions.matchmaking.title')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {t('solutions.matchmaking.description')}
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-[var(--primary-200)] dark:border-[var(--primary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-700)]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--primary-100)] dark:bg-[var(--primary-800)]">
                    <Clock className="size-6 text-[var(--primary-800)] dark:text-[var(--primary-200)]" />
                  </div>
                  <CardTitle className="text-xl">{t('solutions.scheduling.title')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {t('solutions.scheduling.description')}
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-[var(--primary-200)] dark:border-[var(--primary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-700)]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--primary-100)] dark:bg-[var(--primary-800)]">
                    <ShoppingCart className="size-6 text-[var(--primary-800)] dark:text-[var(--primary-200)]" />
                  </div>
                  <CardTitle className="text-xl">{t('solutions.marketplace.title')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {t('solutions.marketplace.description')}
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-[var(--primary-200)] dark:border-[var(--primary-800)] hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary-300)] dark:hover:border-[var(--primary-700)]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--primary-100)] dark:bg-[var(--primary-800)]">
                    <Network className="size-6 text-[var(--primary-800)] dark:text-[var(--primary-200)]" />
                  </div>
                  <CardTitle className="text-xl">{t('solutions.portfolio.title')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {t('solutions.portfolio.description')}
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator className="max-w-md" />

        {/* How It Works Section */}
        <section className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-300">
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white">
              {t('howItWorks.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold">{t('howItWorks.sectionTitle')}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 w-full">
            {[1, 2, 3, 4].map(step => (
              <Card
                key={step}
                className="text-center hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-[var(--secondary-200)] dark:border-[var(--secondary-800)] hover:border-[var(--secondary-300)] dark:hover:border-[var(--secondary-700)]"
              >
                <CardHeader>
                  <div className="mx-auto mb-4 size-16 rounded-full bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)] flex items-center justify-center">
                    <span className="text-3xl font-bold text-[var(--secondary-800)] dark:text-[var(--secondary-200)]">
                      {step}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{t(`howItWorks.step${step}.title`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    {t(`howItWorks.step${step}.description`)}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <Separator className="max-w-md" />

        {/* Why Join Early Section */}
        <section className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-500">
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white">
              {t('whyJoinEarly.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-center">
              {t('whyJoinEarly.sectionTitle')}
            </h2>
            <p className="text-lg text-muted-foreground text-center max-w-2xl m-0">
              {t('whyJoinEarly.description')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {['priority', 'pricing', 'influence', 'exclusive', 'community', 'support'].map(
              benefit => (
                <Card
                  key={benefit}
                  className="hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-[var(--secondary-200)] dark:border-[var(--secondary-800)]"
                >
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-[var(--secondary-100)] dark:bg-[var(--secondary-800)] mt-1">
                        <Sparkles className="size-5 text-[var(--secondary-800)] dark:text-[var(--secondary-200)]" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <CardTitle className="text-lg">
                          {t(`whyJoinEarly.benefits.${benefit}.title`)}
                        </CardTitle>
                        <CardDescription className="text-sm">
                          {t(`whyJoinEarly.benefits.${benefit}.description`)}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              )
            )}
          </div>
        </section>

        <Separator className="max-w-md" />

        {/* CTA Section */}
        <section className="flex flex-col items-center text-center gap-8 animate-fade-in animate-delay-600 cta-gradient py-16 px-8 rounded-2xl w-full shadow-luma">
          <div className="flex flex-col gap-4 max-w-2xl">
            <h2 className="text-4xl md:text-5xl font-bold">{t('cta.headline')}</h2>
            <p className="text-lg text-muted-foreground m-0">{t('cta.description')}</p>
          </div>
          <Button
            size="lg"
            className="button-scale text-lg px-8 py-6 button-gradient text-white"
            asChild
          >
            <a href="#waitlist">{t('cta.button')}</a>
          </Button>
        </section>

        <Separator className="max-w-md" />

        {/* Waitlist Section */}
        <section
          id="waitlist"
          className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-1000"
        >
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white">
              {t('waitlist.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-center">
              {t('waitlist.sectionTitle')}
            </h2>
            <p className="text-lg text-muted-foreground text-center max-w-2xl m-0">
              {t('waitlist.description')}
            </p>
          </div>

          <WaitlistForm />
        </section>

        <Separator className="max-w-md" />

        {/* FAQ Section */}
        <section className="flex flex-col items-center w-full gap-12 animate-fade-in animate-delay-1200">
          <div className="flex flex-col items-center gap-4">
            <Badge className="badge-interactive text-base px-4 py-1 bg-[var(--primary-500)] hover:bg-[var(--primary-600)] text-white">
              {t('faq.sectionBadge')}
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold text-center">{t('faq.sectionTitle')}</h2>
          </div>

          <Card className="w-full">
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                {['cost', 'sports', 'matching', 'privacy', 'availability', 'platforms'].map(key => (
                  <AccordionItem key={key} value={key}>
                    <AccordionTrigger className="text-left">
                      {t(`faq.questions.${key}.question`)}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600 dark:text-gray-400">
                      {t(`faq.questions.${key}.answer`)}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
