import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CourtDetailHeader } from '@/components/court-detail-header';
import { Link } from '@/i18n/navigation';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import { createClient } from '@/lib/supabase/server';
import { Calendar, Info, Lightbulb, MapPin, Palette } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{ id: string; courtId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { courtId } = await params;
  const supabase = await createClient();

  const { data: court } = await supabase
    .from('court')
    .select('name, court_number')
    .eq('id', courtId)
    .single();

  const courtName = court?.name || (court?.court_number ? `Court ${court.court_number}` : 'Court');

  return {
    title: `${courtName} - Rallia`,
    description: 'View and manage court details.',
  };
}

export default async function CourtDetailPage({ params }: PageProps) {
  const { id, courtId } = await params;
  const t = await getTranslations('courts');
  const tAvailability = await getTranslations('availability');
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // Get selected organization (respects user's selection from org switcher)
  const organization = await getSelectedOrganization(user.id);

  if (!organization) {
    notFound();
  }

  // Get user's role in the organization
  const { data: membership } = await supabase
    .from('organization_member')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', organization.id)
    .is('left_at', null)
    .single();

  // Fetch facility to verify access
  const { data: facility } = await supabase
    .from('facility')
    .select('id, name, organization_id')
    .eq('id', id)
    .eq('organization_id', organization.id)
    .single();

  if (!facility) {
    notFound();
  }

  // Fetch court details with sports
  const { data: court, error } = await supabase
    .from('court')
    .select(
      `
      id,
      name,
      court_number,
      surface_type,
      indoor,
      lighting,
      lines_marked_for_multiple_sports,
      availability_status,
      is_active,
      notes,
      attributes,
      court_sport (
        sport_id,
        sport:sport (
          id,
          name
        )
      )
    `
    )
    .eq('id', courtId)
    .eq('facility_id', id)
    .single();

  if (error || !court) {
    notFound();
  }

  // Check if court has custom availability (court_slot entries with this court_id)
  const { count: customSlotCount } = await supabase
    .from('court_slot')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId);

  const hasCustomAvailability = (customSlotCount ?? 0) > 0;
  const canEdit = membership ? ['owner', 'admin'].includes(membership.role) : false;

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <CourtDetailHeader
        facilityId={id}
        facilityName={facility.name}
        court={court}
        canEdit={canEdit}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Court Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="size-5" />
              {t('detail.info')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {court.surface_type && (
                <div className="flex items-center gap-2.5 p-2.5 bg-muted/30 rounded-lg">
                  <div className="p-1.5 bg-muted rounded shrink-0">
                    <Palette className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                      {t('detail.surface')}
                    </p>
                    <p className="text-sm font-medium mb-0">{t(`surface.${court.surface_type}`)}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 p-2.5 bg-muted/30 rounded-lg">
                <div className="p-1.5 bg-muted rounded shrink-0">
                  <MapPin className="size-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                    {t('detail.indoor')}
                  </p>
                  <p className="text-sm font-medium mb-0">
                    {court.indoor ? t('type.indoor') : t('type.outdoor')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2.5 bg-muted/30 rounded-lg">
                <div className="p-1.5 bg-muted rounded shrink-0">
                  <Lightbulb className="size-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                    {t('detail.lighting')}
                  </p>
                  <p className="text-sm font-medium mb-0">{court.lighting ? 'Yes' : 'No'}</p>
                </div>
              </div>

              {court.lines_marked_for_multiple_sports !== undefined && (
                <div className="flex items-center gap-2.5 p-2.5 bg-muted/30 rounded-lg">
                  <div className="p-1.5 bg-muted rounded shrink-0">
                    <Palette className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                      {t('detail.multiSport')}
                    </p>
                    <p className="text-sm font-medium mb-0">
                      {court.lines_marked_for_multiple_sports ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {court.court_sport &&
              Array.isArray(court.court_sport) &&
              court.court_sport.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {t('detail.sports')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {court.court_sport.map(cs => (
                      <Badge key={cs.sport_id} variant="default">
                        {cs.sport?.name || cs.sport_id}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

            {court.notes && (
              <div className="mt-3 p-2.5 bg-muted/30 rounded-lg">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  {t('detail.notes')}
                </p>
                <p className="text-sm leading-relaxed">{court.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Availability Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="size-5" />
              {tAvailability('title')}
            </CardTitle>
            <CardDescription>
              {hasCustomAvailability
                ? t('detail.customAvailabilityNote')
                : t('detail.availabilityNote')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`flex items-center justify-between p-3.5 rounded-lg border transition-colors ${
                hasCustomAvailability
                  ? 'bg-blue-500/5 border-blue-500/20'
                  : 'bg-muted/30 border-border'
              }`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 bg-muted rounded-lg shrink-0">
                  <Calendar
                    className={`size-4 ${
                      hasCustomAvailability ? 'text-blue-500' : 'text-muted-foreground'
                    }`}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm mb-0.5">
                    {hasCustomAvailability
                      ? tAvailability('courtOverride.customSchedule')
                      : tAvailability('courtOverride.useFacilityDefaults')}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-0">
                    {hasCustomAvailability
                      ? tAvailability('courtOverride.customScheduleDescription')
                      : tAvailability('courtOverride.noOverrides')}
                  </p>
                </div>
              </div>
              <Badge
                variant={hasCustomAvailability ? 'default' : 'outline'}
                className="shrink-0 ml-3"
              >
                {hasCustomAvailability ? tAvailability('courtOverride.customSchedule') : 'Default'}
              </Badge>
            </div>

            {canEdit && (
              <div className="mt-4 space-y-2">
                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/dashboard/facilities/${id}/courts/${courtId}/availability`}>
                    {t('detail.manageAvailability')}
                  </Link>
                </Button>
                <Button variant="outline" className="w-full" asChild>
                  <Link
                    href={`/dashboard/facilities/${id}/courts/${courtId}/one-time-availability`}
                  >
                    {t('detail.manageOneTimeAvailability')}
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
