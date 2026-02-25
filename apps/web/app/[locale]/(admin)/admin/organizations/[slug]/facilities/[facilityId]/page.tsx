import { AdminFacilityProfileHeader } from '@/components/admin-facility-profile-header';
import { FacilityContactsSection } from '@/components/facility-contacts-section';
import { FacilityCourtsSection } from '@/components/facility-courts-section';
import { FacilityFilesSection } from '@/components/facility-files-section';
import { FacilityImagesSection } from '@/components/facility-images-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { Building2, Clock, Database, Globe, Hash, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageProps = {
  params: Promise<{ slug: string; facilityId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { facilityId } = await params;
  const t = await getTranslations('admin.organizations.profile');
  const supabase = await createClient();

  const { data: facility } = await supabase
    .from('facility')
    .select('name')
    .eq('id', facilityId)
    .single();

  return {
    title: facility ? `${facility.name} - ${t('facilityDetail.title')}` : t('facilityDetail.title'),
    description: t('facilityDetail.metadata'),
  };
}

export default async function AdminFacilityDetailPage({ params }: PageProps) {
  const { slug, facilityId } = await params;
  const t = await getTranslations('facilities');
  const tProfile = await getTranslations('admin.organizations.profile');
  const supabase = await createClient();

  // Fetch the organization to validate the slug
  const { data: org } = await supabase.from('organization').select('id').eq('slug', slug).single();

  if (!org) {
    notFound();
  }

  // Fetch facility with all related data, ensuring it belongs to this org
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
      data_provider (
        name
      ),
      organization_id,
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
      facility_sport (
        sport_id
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
    .eq('id', facilityId)
    .eq('organization_id', org.id)
    .single();

  if (error || !facility) {
    notFound();
  }

  const courts = Array.isArray(facility.court) ? facility.court : [];

  // Admins always have edit access
  const canEdit = true;

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <AdminFacilityProfileHeader
        facility={{
          id: facilityId,
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
        facilityName={facility.name}
        isActive={facility.is_active}
        address={facility.address}
        city={facility.city}
        country={facility.country}
        organizationSlug={slug}
        organizationId={facility.organization_id}
        backLabel={tProfile('facilityDetail.backToOrganization')}
      />

      {/* Facility Info */}
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
              {facility.facility_type && (
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-muted rounded-md shrink-0">
                    <Building2 className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {t('detail.facilityType')}
                    </p>
                    <p className="text-sm">{t(`facilityTypes.${facility.facility_type}`)}</p>
                  </div>
                </div>
              )}

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

              {facility.data_provider && (
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-muted rounded-md shrink-0">
                    <Database className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {t('detail.dataProvider')}
                    </p>
                    <p className="text-sm">{facility.data_provider.name}</p>
                  </div>
                </div>
              )}

              {facility.external_provider_id && (
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-muted rounded-md shrink-0">
                    <Hash className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {t('detail.externalProviderId')}
                    </p>
                    <p className="text-sm font-mono">{facility.external_provider_id}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Courts Section */}
      <FacilityCourtsSection
        facilityId={facilityId}
        courts={courts}
        canEdit={canEdit}
        disableCourtLinks
      />

      {/* Contacts Section */}
      <FacilityContactsSection
        facilityId={facilityId}
        contacts={Array.isArray(facility.facility_contact) ? facility.facility_contact : []}
        canEdit={canEdit}
      />

      {/* Images Section */}
      <FacilityImagesSection
        facilityId={facilityId}
        images={Array.isArray(facility.facility_image) ? facility.facility_image : []}
        canEdit={canEdit}
      />

      {/* Files Section */}
      <FacilityFilesSection
        facilityId={facilityId}
        files={Array.isArray(facility.facility_file) ? facility.facility_file : []}
        canEdit={canEdit}
      />
    </div>
  );
}
