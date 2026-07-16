'use client';

import dynamic from 'next/dynamic';
import { MapPinned } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PublicMatch } from './public-match-card';

import { Skeleton } from '@/components/ui/skeleton';

const GamesMatchMapInner = dynamic(() => import('./games-match-map-inner'), {
  ssr: false,
  loading: () => <Skeleton className="w-full h-[70vh] min-h-[420px] rounded-xl" />,
});

interface GamesMatchMapProps {
  matches: PublicMatch[];
  viewerPlayerId?: string | null;
  center: [number, number] | null;
  onJoin: (matchId: string) => void;
}

/** Count matches that carry usable coordinates (facility or custom location). */
function mappableCount(matches: PublicMatch[]): number {
  return matches.filter(
    m =>
      (m.facility?.latitude != null && m.facility?.longitude != null) ||
      (m.custom_latitude != null && m.custom_longitude != null)
  ).length;
}

export default function GamesMatchMap({
  matches,
  viewerPlayerId,
  center,
  onJoin,
}: GamesMatchMapProps) {
  const t = useTranslations('gamesPage');
  const shown = mappableCount(matches);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPinned className="size-4" />
        {t('mapGamesShown', { count: shown })}
      </div>
      <GamesMatchMapInner
        matches={matches}
        viewerPlayerId={viewerPlayerId}
        center={center}
        onJoin={onJoin}
      />
    </div>
  );
}
