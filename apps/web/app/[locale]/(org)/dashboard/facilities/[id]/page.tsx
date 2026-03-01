import { FacilityContactsSection } from '@/components/facility-contacts-section';
import { FacilityCourtsSection } from '@/components/facility-courts-section';
import { FacilityEditButton } from '@/components/facility-edit-button';
import { FacilityFilesSection } from '@/components/facility-files-section';
import { FacilityImagesSection } from '@/components/facility-images-section';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import { createClient } from '@/lib/supabase/server';
import { BackButton } from '@/components/back-button';
import { Building2, Calendar, Clock, Globe, MapPin, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: facility } = await supabase.from('facility').select('name').eq('id', id).single();

  return {
    title: facility ? `${facility.name} - Rallia` : 'Facility - Rallia',
    description: 'Manage facility details and courts.',
  };
}

export default async function FacilityDetailPage({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations('facilities');
  const tAvailability = await getTranslations('availability');
  const tBlocks = await getTranslations('blocks');
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get selected organization (respects user's selection from org switcher)
  const organization = await getSelectedOrganization(user!.id);

  if (!organization) {
    notFound();
  }

  // Get user's role in the organization
  const { data: membership } = await supabase
    .from('organization_member')
    .select('role')
    .eq('user_id', user!.id)
    .eq('organization_id', organization.id)
    .is('left_at', null)
    .single();

  // Fetch facility with courts and contacts
  const { data: facility, error } = await supabase
    .from('facility')
    .select(
      `
      id,
      name,
      description,
      address,
      city,
      country,
      postal_code,
      latitude,
      longitude,
      timezone,
      is_active,
      membership_required,
      facility_type,
      data_provider_id,
      external_provider_id,
      organization_id,
      facility_sport (
        sport_id
      ),
      court (
        id,
        name,
        court_number,
        surface_type,
        indoor,
        lighting,
        availability_status,
        is_active,
        court_sport (
          sport_id,
          sport:sport (
            id,
            name
          )
        )
      ),
      facility_contact (
        id,
        contact_type,
        phone,
        email,
        website,
        is_primary,
        sport_id,
        notes,
        sport:sport (
          id,
          name
        )
      ),
      facility_image (
        id,
        url,
        thumbnail_url,
        display_order,
        is_primary,
        description
      ),
      facility_file (
        id,
        file_id,
        display_order,
        is_primary,
        file:file (
          id,
          file_type,
          original_name,
          file_size,
          url,
          mime_type,
          storage_key
        )
      )
    `
    )
    .eq('id', id)
    .eq('organization_id', organization.id)
    .single();

  if (error || !facility) {
    notFound();
  }

  const courts = Array.isArray(facility.court) ? facility.court : [];
  const activeCourts = courts.filter(c => c.is_active);

  // Check if user can edit (owner or admin)
  const canEdit = membership ? ['owner', 'admin'].includes(membership.role) : false;

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <BackButton className="p-2 hover:bg-muted rounded-md transition-colors mt-1 inline-flex items-center">
            <span className="sr-only">Back</span>
          </BackButton>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold m-0">{facility.name}</h1>
              <Badge variant={facility.is_active ? 'default' : 'secondary'}>
                {facility.is_active ? t('status.active') : t('status.inactive')}
              </Badge>
            </div>
            {(facility.address || facility.city) && (
              <p className="text-muted-foreground mb-0 flex items-center gap-1">
                <MapPin className="size-4" />
                {[facility.address, facility.city, facility.country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <FacilityEditButton
            facility={{
              id,
              name: facility.name,
              description: facility.description,
              facility_type: facility.facility_type,
              address: facility.address,
              city: facility.city,
              postal_code: facility.postal_code,
              country: facility.country,
              latitude: facility.latitude,
              longitude: facility.longitude,
              timezone: facility.timezone,
              membership_required: facility.membership_required,
              data_provider_id: facility.data_provider_id,
              external_provider_id: facility.external_provider_id,
              facility_sport: Array.isArray(facility.facility_sport) ? facility.facility_sport : [],
            }}
          />
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg shrink-0">
                <Building2 className="size-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none mb-1">{courts.length}</p>
                <p className="text-sm text-muted-foreground mb-0">
                  {t('detail.stats.totalCourts')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500/10 rounded-lg shrink-0">
                <Users className="size-6 text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none mb-1">{activeCourts.length}</p>
                <p className="text-sm text-muted-foreground mb-0">
                  {t('detail.stats.activeCourts')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 rounded-lg shrink-0">
                <Calendar className="size-6 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none mb-1">—</p>
                <p className="text-sm text-muted-foreground mb-0">
                  {t('detail.stats.activeBookings')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Facility Info */}
      {(facility.description ||
        facility.timezone ||
        facility.postal_code ||
        facility.membership_required !== undefined) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{t('detail.info')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {facility.description && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {t('detail.description')}
                  </p>
                  <p className="text-sm leading-relaxed">{facility.description}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {facility.timezone && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-muted rounded-md shrink-0">
                      <Clock className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        {t('detail.timezone')}
                      </p>
                      <p className="text-sm">{facility.timezone}</p>
                    </div>
                  </div>
                )}

                {facility.postal_code && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-muted rounded-md shrink-0">
                      <MapPin className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        {t('detail.postalCode')}
                      </p>
                      <p className="text-sm">{facility.postal_code}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <div className="p-2 bg-muted rounded-md shrink-0">
                    <Globe className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {t('detail.membershipRequired')}
                    </p>
                    <p className="text-sm">{facility.membership_required ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`/dashboard/facilities/${id}/availability`} className="block">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Clock className="size-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{tAvailability('title')}</CardTitle>
                  <CardDescription>{tAvailability('description')}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Link>
        </Card>

        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`/dashboard/facilities/${id}/blocks`} className="block">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-md">
                  <Calendar className="size-5 text-orange-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">{tBlocks('title')}</CardTitle>
                  <CardDescription>{tBlocks('description')}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Link>
        </Card>
      </div>

      {/* Images Section */}
      <FacilityImagesSection
        facilityId={id}
        images={Array.isArray(facility.facility_image) ? facility.facility_image : []}
        canEdit={canEdit}
      />

      {/* Contacts Section */}
      <FacilityContactsSection
        facilityId={id}
        contacts={Array.isArray(facility.facility_contact) ? facility.facility_contact : []}
        canEdit={canEdit}
      />

      {/* Files Section */}
      <FacilityFilesSection
        facilityId={id}
        files={Array.isArray(facility.facility_file) ? facility.facility_file : []}
        canEdit={canEdit}
      />

      {/* Courts Section */}
      <FacilityCourtsSection facilityId={id} courts={courts} canEdit={canEdit} />
    </div>
  );
}
