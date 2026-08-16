import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CalendarDays, MapPin, Trophy } from 'lucide-react';
import { getTournamentLogoUrl } from '@rallia/shared-utils';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { buildPageMetadata } from '@/lib/seo';
import { formatDateRange } from '@/lib/format-date-range';

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

  return tournaments.flatMap(t => {
    const referralCode = codeByOrganizer.get(t.organizer_id);
    return referralCode ? [{ ...t, referralCode }] : [];
  });
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

export default async function EventsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('eventsPage');
  const events = await getPublicEvents();

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold">{t('emptyTitle')}</h2>
          <p className="mt-2 text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map(event => {
            const logo = getTournamentLogoUrl(event.logo_url);
            const location = eventLocation(event);
            const sportName = event.sport?.name
              ? event.sport.name.charAt(0).toUpperCase() + event.sport.name.slice(1)
              : null;
            return (
              <Link
                key={event.id}
                href={`/invite/${event.referralCode}?type=tournament&id=${event.id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full"
              >
                <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />

                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={event.name} className="h-36 w-full object-cover" />
                ) : (
                  <div className="h-36 w-full bg-muted flex items-center justify-center">
                    <Trophy className="size-10 text-muted-foreground/40" />
                  </div>
                )}

                <div className="flex flex-col gap-3 p-5 flex-1">
                  <h3 className="font-semibold text-foreground truncate">{event.name}</h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={event.status === 'registration_open' ? 'default' : 'secondary'}>
                      {t(STATUS_KEY[event.status])}
                    </Badge>
                    {sportName && <Badge variant="outline">{sportName}</Badge>}
                    <Badge variant="outline">
                      {event.entry_format === 'doubles' ? t('doubles') : t('singles')}
                    </Badge>
                  </div>

                  <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5 shrink-0" />
                      {formatDateRange(event.start_date, event.end_date, locale)}
                    </span>
                    {location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" />
                        <span className="truncate">{location}</span>
                      </span>
                    )}
                  </div>

                  {event.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {event.description}
                    </p>
                  )}

                  <span className="mt-auto pt-1 text-sm font-semibold text-primary group-hover:underline">
                    {t('viewTournament')}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
