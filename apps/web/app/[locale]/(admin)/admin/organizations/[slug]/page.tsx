import { AdminOrgFacilitiesSection } from '@/components/admin-org-facilities-section';
import { AdminOrgProfileHeader } from '@/components/admin-org-profile-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/server';
import { Tables } from '@/types';
import { Database, Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

// Helper to capitalize strings
function capitalize(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Type aliases for relations
type FacilityFileJoin = {
  id: string;
  display_order: number | null;
  is_primary: boolean | null;
  file: {
    id: string;
    url: string;
    thumbnail_url: string | null;
  } | null;
};
type Sport = Pick<Tables<'sport'>, 'id' | 'name' | 'slug'>;
type Facility = Pick<
  Tables<'facility'>,
  'id' | 'name' | 'slug' | 'address' | 'city' | 'country' | 'postal_code'
> & {
  facility_file: FacilityFileJoin[];
  facility_sport: Array<{
    sport_id: string;
    sport: Sport;
  }>;
};
type Organization = Pick<
  Tables<'organization'>,
  | 'id'
  | 'slug'
  | 'name'
  | 'nature'
  | 'type'
  | 'email'
  | 'phone'
  | 'address'
  | 'city'
  | 'country'
  | 'postal_code'
  | 'website'
  | 'description'
  | 'data_provider_id'
  | 'is_active'
  | 'created_at'
  | 'updated_at'
> & {
  data_provider: { name: string } | null;
  facilities: Facility[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('admin.organizations.profile');
  const supabase = await createClient();

  try {
    const { data: organization } = await supabase
      .from('organization')
      .select('name, description')
      .eq('slug', slug)
      .single();

    if (organization) {
      return {
        title: `${organization.name} - ${t('titleMeta')}`,
        description: organization.description || t('descriptionMeta'),
      };
    }
  } catch {
    // Fallback metadata
  }

  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function OrganizationProfilePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  const t = await getTranslations('admin.organizations.profile');
  const supabase = await createClient();

  let organization: Organization | null = null;

  try {
    // Fetch organization
    const { data: orgData, error: orgError } = await supabase
      .from('organization')
      .select(
        `
        id,
        slug,
        name,
        nature,
        type,
        email,
        phone,
        address,
        city,
        country,
        postal_code,
        website,
        description,
        data_provider_id,
        data_provider (
          name
        ),
        is_active,
        created_at,
        updated_at
      `
      )
      .eq('slug', slug)
      .single();

    if (orgError || !orgData) {
      notFound();
    }

    // Fetch facilities with images and sports for overview
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facility')
      .select(
        `
        id,
        name,
        slug,
        address,
        city,
        country,
        postal_code,
        facility_file (
          id,
          display_order,
          is_primary,
          file (
            id,
            url,
            thumbnail_url
          )
        ),
        facility_sport (
          sport_id,
          sport (
            id,
            name,
            slug
          )
        )
      `
      )
      .eq('organization_id', orgData.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (facilitiesError) {
      throw new Error('Failed to fetch facilities');
    }

    organization = {
      ...orgData,
      facilities: facilities || [],
    };
  } catch (error) {
    console.error('Error fetching organization:', error);
    return (
      <div className="flex flex-col w-full gap-8">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive m-0">{t('error')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!organization) {
    notFound();
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  };

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <AdminOrgProfileHeader
        slug={slug}
        organizationName={organization.name}
        title={organization.name}
        description={t('description', { slug })}
        updateButtonLabel={t('updateButton')}
        backLabel={t('backToOrganizations')}
        initialData={{
          slug: organization.slug,
          name: organization.name,
          nature: organization.nature as 'public' | 'private',
          type: organization.type,
          email: organization.email,
          phone: organization.phone,
          website: organization.website,
          description: organization.description,
          is_active: organization.is_active,
          data_provider_id: organization.data_provider_id,
          address: organization.address,
          city: organization.city,
          country: organization.country,
          postal_code: organization.postal_code,
        }}
      />

      {/* Organization Info */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/30 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('sections.organizationInfo')}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {organization.nature && (
                <Badge variant="outline" className="font-medium">
                  {t(`nature.${organization.nature}`)}
                </Badge>
              )}
              {organization.type && (
                <Badge variant="outline" className="font-medium">
                  {capitalize(organization.type)}
                </Badge>
              )}
              <Badge
                variant={organization.is_active ? 'default' : 'secondary'}
                className="font-medium"
              >
                {organization.is_active ? t('status.active') : t('status.inactive')}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {organization.description && (
            <div className="bg-muted/20 rounded-lg p-4">
              <p className="text-sm font-medium text-muted-foreground mb-2 mt-0">
                {t('fields.description')}
              </p>
              <p className="text-base leading-relaxed m-0">{organization.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {organization.email && (
              <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
                    {t('fields.email')}
                  </p>
                  <a
                    href={`mailto:${organization.email}`}
                    className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                  >
                    {organization.email}
                  </a>
                </div>
              </div>
            )}

            {organization.phone && (
              <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
                    {t('fields.phone')}
                  </p>
                  <a
                    href={`tel:${organization.phone}`}
                    className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                  >
                    {organization.phone}
                  </a>
                </div>
              </div>
            )}

            {organization.website && (
              <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Globe className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
                    {t('fields.website')}
                  </p>
                  <a
                    href={organization.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                  >
                    {organization.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              </div>
            )}

            {(organization.address || organization.city || organization.country) && (
              <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="p-2 bg-primary/10 rounded-md">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
                    {t('fields.address')}
                  </p>
                  <p className="text-sm font-medium m-0">
                    {[
                      organization.address,
                      organization.city,
                      capitalize(organization.country),
                      organization.postal_code,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
              </div>
            )}

            {organization.data_provider && (
              <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Database className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
                    {t('fields.dataProvider')}
                  </p>
                  <p className="text-sm font-medium m-0">{organization.data_provider.name}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-muted/20 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-0">
                {t('fields.createdAt')}
              </p>
              <p className="text-sm font-semibold m-0">{formatDate(organization.created_at)}</p>
            </div>
            <div className="text-center p-3 bg-muted/20 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-0">
                {t('fields.updatedAt')}
              </p>
              <p className="text-sm font-semibold m-0">{formatDate(organization.updated_at)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Facilities */}
      <AdminOrgFacilitiesSection
        facilities={organization.facilities}
        organizationId={organization.id}
        slug={slug}
      />
    </div>
  );
}
