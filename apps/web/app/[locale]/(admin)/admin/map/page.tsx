import {
  AdminPlayerMap,
  type FacilityMapPoint,
  type PlayerMapPoint,
} from '@/components/admin-player-map';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.map');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminMapPage() {
  const t = await getTranslations('admin.map');
  const supabase = await createClient();

  let points: PlayerMapPoint[] = [];
  let facilities: FacilityMapPoint[] = [];
  let error: string | null = null;

  try {
    const [playersResult, facilitiesResult] = await Promise.all([
      supabase
        .from('player')
        .select(
          `
          latitude,
          longitude,
          city,
          province,
          country,
          gender,
          last_seen_at,
          created_at,
          profile!inner (
            first_name,
            last_name,
            is_active,
            account_status
          ),
          player_sport (
            is_primary,
            sport (
              name
            )
          )
        `
        )
        .not('latitude', 'is', null)
        .not('longitude', 'is', null),
      supabase
        .from('facility')
        .select(
          `
          id,
          name,
          latitude,
          longitude,
          address,
          city,
          facility_type,
          external_provider_id,
          is_first_come_first_serve,
          organization:organization_id (
            nature
          ),
          facility_sport (
            sport (
              name
            )
          ),
          court (
            id,
            indoor,
            lighting
          )
        `
        )
        .eq('is_active', true)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null),
    ]);

    if (playersResult.error) throw playersResult.error;
    if (facilitiesResult.error) throw facilitiesResult.error;

    points = (playersResult.data ?? []).map((player: any) => ({
      latitude: Number(player.latitude),
      longitude: Number(player.longitude),
      city: player.city,
      province: player.province,
      country: player.country,
      gender: player.gender,
      firstName: player.profile?.first_name ?? null,
      lastName: player.profile?.last_name ?? null,
      lastSeenAt: player.last_seen_at,
      createdAt: player.created_at,
      isActive: player.profile?.is_active ?? true,
      accountStatus: player.profile?.account_status ?? 'active',
      sports: (player.player_sport ?? []).map((ps: any) => ps.sport?.name).filter(Boolean),
    }));

    facilities = (facilitiesResult.data ?? []).map((f: any) => {
      const courts = f.court ?? [];
      return {
        id: f.id,
        name: f.name,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        address: f.address,
        city: f.city,
        facilityType: f.facility_type,
        sports: (f.facility_sport ?? []).map((fs: any) => fs.sport?.name).filter(Boolean),
        courtCount: courts.length,
        hasExternalProvider: !!f.external_provider_id,
        organizationNature: f.organization?.nature ?? null,
        isFirstComeFirstServe: f.is_first_come_first_serve ?? false,
        hasIndoorCourts: courts.some((c: any) => c.indoor === true),
        hasOutdoorCourts: courts.some((c: any) => c.indoor === false),
        hasLighting: courts.some((c: any) => c.lighting === true),
      };
    });
  } catch (e) {
    console.error('Error fetching map data:', e);
    error = t('noData');
  }

  return (
    <div className="flex flex-col w-full gap-6 h-full">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>

      {error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <AdminPlayerMap points={points} facilities={facilities} />
      )}
    </div>
  );
}
