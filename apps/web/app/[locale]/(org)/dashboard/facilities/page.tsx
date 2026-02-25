import { FacilitiesList } from '@/components/facilities-list';
import { createClient } from '@/lib/supabase/server';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Facilities - Rallia',
    description: 'Manage your organization facilities.',
  };
}

export default async function FacilitiesPage() {
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get selected organization (respects user's selection from org switcher)
  const organization = await getSelectedOrganization(user!.id);

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground">No organization found.</p>
      </div>
    );
  }

  // Fetch facilities with court details including availability status
  const { data: facilities, error } = await supabase
    .from('facility')
    .select(
      `
      id,
      name,
      description,
      address,
      city,
      postal_code,
      country,
      latitude,
      longitude,
      timezone,
      is_active,
      membership_required,
      facility_type,
      data_provider_id,
      external_provider_id,
      created_at,
      court (
        id,
        availability_status,
        is_active
      ),
      facility_sport (
        sport_id
      )
    `
    )
    .eq('organization_id', organization.id)
    .is('archived_at', null)
    .order('name');

  if (error) {
    console.error('Error fetching facilities:', error);
  }

  return <FacilitiesList facilities={facilities ?? []} organizationId={organization.id} />;
}
