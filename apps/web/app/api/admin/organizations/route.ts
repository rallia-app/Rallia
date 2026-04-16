import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is a super_admin (only super admins can delete organizations)
    const { allowed } = await requireApiRole(user.id, ['super_admin']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const { organizationIds } = await request.json();

    if (!organizationIds || !Array.isArray(organizationIds) || organizationIds.length === 0) {
      return NextResponse.json({ error: 'Missing organization IDs' }, { status: 400 });
    }

    const deletedOrgs: string[] = [];
    const errors: string[] = [];

    for (const orgId of organizationIds) {
      try {
        // Get all facilities for this organization
        const { data: facilities } = await supabase
          .from('facility')
          .select('id')
          .eq('organization_id', orgId);

        const facilityIds = facilities?.map(f => f.id) || [];

        // Delete all related data for each facility
        for (const facilityId of facilityIds) {
          // Get courts for this facility
          const { data: courts } = await supabase
            .from('court')
            .select('id')
            .eq('facility_id', facilityId);

          if (courts && courts.length > 0) {
            const courtIds = courts.map((c: { id: string }) => c.id);
            // Delete court_sports
            await supabase.from('court_sport').delete().in('court_id', courtIds);
            // Delete courts
            await supabase.from('court').delete().in('id', courtIds);
          }

          // Delete facility_sports
          await supabase.from('facility_sport').delete().eq('facility_id', facilityId);

          // Delete facility_contacts
          await supabase.from('facility_contact').delete().eq('facility_id', facilityId);

          // Delete facility_files and associated files
          const { data: facilityFiles } = await supabase
            .from('facility_file')
            .select('id, file_id, file(storage_key)')
            .eq('facility_id', facilityId);

          if (facilityFiles && facilityFiles.length > 0) {
            // Delete from storage
            const storageKeys = facilityFiles
              .map((ff: { file?: { storage_key?: string } | null }) => ff.file?.storage_key)
              .filter((key): key is string => Boolean(key));
            if (storageKeys.length > 0) {
              await supabase.storage.from('facility-images').remove(storageKeys);
            }

            // Delete facility_files junction records
            await supabase.from('facility_file').delete().eq('facility_id', facilityId);

            // Delete files records
            const fileIds = facilityFiles.map((ff: { file_id: string }) => ff.file_id);
            if (fileIds.length > 0) {
              await supabase.from('file').delete().in('id', fileIds);
            }
          }
        }

        // Delete all facilities
        if (facilityIds.length > 0) {
          await supabase.from('facility').delete().in('id', facilityIds);
        }

        // Delete organization_members
        await supabase.from('organization_member').delete().eq('organization_id', orgId);

        // Delete the organization
        const { error: deleteError } = await supabase.from('organization').delete().eq('id', orgId);

        if (deleteError) {
          errors.push(`Failed to delete organization ${orgId}: ${deleteError.message}`);
        } else {
          deletedOrgs.push(orgId);
        }
      } catch (error) {
        errors.push(
          `Error deleting organization ${orgId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        deletedCount: deletedOrgs.length,
        deletedIds: deletedOrgs,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Admin Org Bulk Delete] Unexpected error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'An error occurred while deleting organizations',
      },
      { status: 500 }
    );
  }
}
