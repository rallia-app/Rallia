import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, MapPin, Clock, Users, Trophy } from 'lucide-react';
import Image from 'next/image';
import type { Match } from '@rallia/shared-types';

/** Shape returned by the Supabase query with selected relation columns */
type MatchWithRelations = Match & {
  sport: Pick<{ name: string }, 'name'> | null;
  facility: Pick<{ name: string; city: string }, 'name' | 'city'> | null;
  min_rating_score: Pick<{ label: string }, 'label'> | null;
};

type Props = {
  params: Promise<{ id: string; locale: string }>;
};

async function getMatch(id: string): Promise<MatchWithRelations | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      '*, sport:sport_id (name), facility:facility_id (name, city), min_rating_score:min_rating_score_id (label)'
    )
    .eq('id', id)
    .single();
  return data as MatchWithRelations | null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params;
  const match = await getMatch(id);
  const t = await getTranslations({ locale, namespace: 'matchPage' });

  if (!match) {
    return { title: t('notFound') };
  }

  const sportName = match.sport?.name ?? '';
  const { facility } = match;
  const location = facility ? `${facility.name}, ${facility.city}` : '';
  const date = new Date(`${match.match_date}T${match.start_time}`).toLocaleDateString(locale, {
    dateStyle: 'long',
  });

  return {
    title: `${sportName} — ${date}`,
    description: `${sportName} ${t('at')} ${location} — ${date}`,
    openGraph: {
      title: `${sportName} — ${date}`,
      description: `${sportName} ${t('at')} ${location} — ${date}`,
    },
  };
}

export default async function MatchPage({ params }: Props) {
  const { id, locale } = await params;
  const match = await getMatch(id);
  const t = await getTranslations({ locale, namespace: 'matchPage' });

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  const sportName = match.sport?.name ?? '';
  const location = match.facility ? `${match.facility.name}, ${match.facility.city}` : '';
  const minLevel = match.min_rating_score?.label;
  const dateTime = new Date(`${match.match_date}T${match.start_time}`);
  const date = dateTime.toLocaleDateString(locale, { dateStyle: 'long' });
  const time = dateTime.toLocaleTimeString(locale, { timeStyle: 'short' });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-12 w-full max-w-3xl mx-auto">
      <Card className="p-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {sportName}
            </Badge>
            {minLevel && <Badge variant="outline">{minLevel}</Badge>}
          </div>
          <CardTitle className="text-2xl mt-2">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center text-sm">
            <div className="flex items-center gap-2 w-1/2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span>{date}</span>
            </div>
            <div className="flex items-center gap-2 w-1/2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{time}</span>
            </div>
          </div>
          {(match.format || match.duration) && (
            <div className="flex items-center text-sm">
              {match.format && (
                <div className="flex items-center gap-2 w-1/2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="capitalize">{t(`format.${match.format}`)}</span>
                </div>
              )}
              {match.duration && (
                <div className="flex items-center gap-2 w-1/2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {match.duration} {t('minutes')}
                  </span>
                </div>
              )}
            </div>
          )}
          {location && (
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{location}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="cta-gradient p-4 rounded-2xl shadow-luma animate-fade-in flex h-full">
        <div className="flex flex-col items-center justify-center gap-5 text-center flex-1">
          <h2 className="text-xl font-bold">{t('downloadTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('downloadDescription')}</p>
          <div className="flex gap-4">
            <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer">
              <Image
                src="/app-store-badge.svg"
                alt={t('appStore')}
                width={120}
                height={40}
                className="button-scale"
              />
            </a>
            <a href="https://play.google.com" target="_blank" rel="noopener noreferrer">
              <Image
                src="/google-play-badge.svg"
                alt={t('googlePlay')}
                width={135}
                height={40}
                className="button-scale"
              />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
