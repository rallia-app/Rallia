import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, CalendarDays, MapPin, Trophy } from 'lucide-react';
import { getTournamentLogoUrl } from '@rallia/shared-utils';

import { UtmForwardingLink } from './_components/utm-forwarding-link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { buildPageMetadata } from '@/lib/seo';
import { formatDateRange } from '@/lib/format-date-range';
import { cn } from '@/lib/utils';

// Public directory — same page for every visitor, so serve it from the ISR
// cache instead of a function invocation per hit.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/events', namespace: 'seo.events' });
}

type EventStatus = 'registration_open' | 'registration_closed' | 'in_progress';

interface PublicTournament {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  status: EventStatus;
  start_date: string;
  end_date: string;
  city: string | null;
  venue_name: string | null;
  entry_format: 'singles' | 'doubles';
  organizer_id: string;
  sport: { name: string } | null;
  facility: { name: string; city: string | null } | null;
}

interface PublicEvent extends PublicTournament {
  referralCode: string;
}

// Registration-open tournaments are the only ones an ad visitor can act on,
// so they lead; closed-but-upcoming next, live brackets last.
const STATUS_ORDER: Record<EventStatus, number> = {
  registration_open: 0,
  registration_closed: 1,
  in_progress: 2,
};

/** Public tournaments plus each organizer's referral code — the invite link
 *  format (/invite/{code}?type=tournament&id=…) requires one, so a tournament
 *  whose organizer has no code is dropped rather than linked to a dead page. */
async function getPublicEvents(): Promise<PublicEvent[]> {
  // The web Database type deliberately omits the mobile-only tournament tables.
  const supabase =
    createServiceRoleClient() as unknown as import('@supabase/supabase-js').SupabaseClient;

  const { data, error } = await supabase
    .from('tournaments')
    .select(
      'id, name, description, logo_url, status, start_date, end_date, city, venue_name, entry_format, organizer_id, sport:sport_id (name), facility:facility_id (name, city)'
    )
    .eq('visibility', 'public')
    .in('status', ['registration_open', 'registration_closed', 'in_progress'])
    .order('start_date', { ascending: true });
  if (error || !data?.length) return [];
  const tournaments = data as unknown as PublicTournament[];

  const organizerIds = [...new Set(tournaments.map(t => t.organizer_id))];
  const { data: profiles } = await supabase
    .from('profile')
    .select('id, referral_code')
    .in('id', organizerIds);
  const codeByOrganizer = new Map<string, string>(
    ((profiles ?? []) as { id: string; referral_code: string | null }[])
      .filter(p => p.referral_code)
      .map(p => [p.id, p.referral_code as string])
  );

  return tournaments
    .flatMap(t => {
      const referralCode = codeByOrganizer.get(t.organizer_id);
      return referralCode ? [{ ...t, referralCode }] : [];
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.start_date.localeCompare(b.start_date)
    );
}

function eventLocation(event: PublicTournament): string {
  const venue = event.venue_name ?? event.facility?.name ?? null;
  const city = event.city ?? event.facility?.city ?? null;
  return [venue, city].filter(Boolean).join(', ');
}

const STATUS_KEY: Record<EventStatus, string> = {
  registration_open: 'statusRegistrationOpen',
  registration_closed: 'statusRegistrationClosed',
  in_progress: 'statusInProgress',
};

// Overlaid on the artwork, so each status carries its own surface: teal for
// actionable, coral for live, frosted neutral for closed.
const STATUS_BADGE_CLASS: Record<EventStatus, string> = {
  registration_open: 'bg-primary text-primary-foreground shadow-md',
  in_progress: 'bg-[var(--secondary-500)] text-white shadow-md',
  registration_closed: 'bg-background/85 text-foreground backdrop-blur-sm shadow-md',
};

type TFn = Awaited<ReturnType<typeof getTranslations<'eventsPage'>>>;

function EventCard({ event, locale, t }: { event: PublicEvent; locale: Locale; t: TFn }) {
  const logo = getTournamentLogoUrl(event.logo_url);
  const location = eventLocation(event);
  const sportName = event.sport?.name
    ? event.sport.name.charAt(0).toUpperCase() + event.sport.name.slice(1)
    : null;
  const format = event.entry_format === 'doubles' ? t('doubles') : t('singles');

  return (
    <UtmForwardingLink
      href={`/invite/${event.referralCode}?type=tournament&id=${event.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 h-full"
    >
      <div className="relative h-44 w-full overflow-hidden">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={event.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--primary-100)] via-[var(--primary-50)] to-[var(--secondary-100)] dark:from-[var(--primary-800)] dark:via-[var(--primary-900)] dark:to-[var(--primary-950)]">
            <Trophy
              className="size-12 text-[var(--primary-500)]/50 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
              strokeWidth={1.5}
            />
          </div>
        )}
        <Badge
          className={cn(
            'absolute left-3 top-3 border-transparent px-3 py-1',
            STATUS_BADGE_CLASS[event.status]
          )}
        >
          {t(STATUS_KEY[event.status])}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            {[sportName, format].filter(Boolean).join(' · ')}
          </p>
          <h3 className="text-lg font-bold leading-snug text-foreground line-clamp-2">
            {event.name}
          </h3>
        </div>

        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-primary/70" />
            {formatDateRange(event.start_date, event.end_date, locale)}
          </span>
          {location && (
            <span className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0 text-primary/70" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </div>

        {event.description && (
          <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
            {event.description}
          </p>
        )}

        <span className={cn(buttonVariants({ size: 'sm' }), 'mt-auto w-full')}>
          {t('viewTournament')}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </UtmForwardingLink>
  );
}

export default async function EventsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('eventsPage');
  const events = await getPublicEvents();

  return (
    <div className="relative flex w-full flex-col gap-10 animate-fade-in">
      {/* Decorative glow behind the hero — subtle in both themes */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-20 -z-10 flex justify-center"
      >
        <div className="h-64 w-64 -translate-x-24 rounded-full bg-[var(--primary-400)]/15 blur-3xl" />
        <div className="h-56 w-56 translate-x-24 translate-y-8 rounded-full bg-[var(--secondary-400)]/10 blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary-300)]/50 bg-[var(--primary-100)]/60 px-4 py-1.5 text-sm font-semibold text-[var(--primary-700)] dark:border-[var(--primary-600)]/70 dark:bg-white/5 dark:text-[var(--primary-200)]">
          <Trophy className="size-4" />
          {t('eyebrow')}
        </span>
        <h1 className="text-4xl sm:text-5xl">{t('title')}</h1>
        <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>

      {events.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[var(--primary-100)] dark:bg-white/10">
            <Trophy className="size-8 text-primary" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold">{t('emptyTitle')}</h2>
          <p className="text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map(event => (
            <EventCard key={event.id} event={event} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
