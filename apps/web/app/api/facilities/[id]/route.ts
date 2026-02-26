import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

type FacilityFileWithStorage = {
  id: string;
  file_id: string;
  file?: { storage_key: string } | null;
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: facilityId } = await params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get existing facility
    const { data: facility, error: facilityFetchError } = await supabase
      .from('facility')
      .select('id, name')
      .eq('id', facilityId)
      .single();

    if (facilityFetchError || !facility) {
      return NextResponse.json({ error: 'Facility not found' }, { status: 404 });
    }

    // Get courts for this facility
    const { data: courts } = await supabase
      .from('court')
      .select('id')
      .eq('facility_id', facilityId);

    if (courts && courts.length > 0) {
      const courtIds = courts.map((c: { id: string }) => c.id);
      // Delete court_sports
      const { error: courtSportError } = await supabase
        .from('court_sport')
        .delete()
        .in('court_id', courtIds);
      if (courtSportError)
        console.error('[Facility Delete] court_sport delete error:', courtSportError);
      // Delete courts
      const { error: courtError } = await supabase.from('court').delete().in('id', courtIds);
      if (courtError) console.error('[Facility Delete] court delete error:', courtError);
    }

    // Delete facility_sports
    const { error: fSportError } = await supabase
      .from('facility_sport')
      .delete()
      .eq('facility_id', facilityId);
    if (fSportError) console.error('[Facility Delete] facility_sport delete error:', fSportError);

    // Delete facility_contacts
    const { error: fContactError } = await supabase
      .from('facility_contact')
      .delete()
      .eq('facility_id', facilityId);
    if (fContactError)
      console.error('[Facility Delete] facility_contact delete error:', fContactError);

    // Delete facility_files and associated files
    const { data: facilityFiles } = await supabase
      .from('facility_file')
      .select('id, file_id, file(storage_key)')
      .eq('facility_id', facilityId);

    if (facilityFiles && facilityFiles.length > 0) {
      // Delete from storage
      const storageKeys = (facilityFiles as FacilityFileWithStorage[])
        .map(ff => ff.file?.storage_key)
        .filter((key): key is string => Boolean(key));
      if (storageKeys.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('facility-images')
          .remove(storageKeys);
        if (storageError) console.error('[Facility Delete] storage delete error:', storageError);
      }

      // Delete facility_files junction records
      const { error: ffError } = await supabase
        .from('facility_file')
        .delete()
        .eq('facility_id', facilityId);
      if (ffError) console.error('[Facility Delete] facility_file delete error:', ffError);

      // Delete file records
      const fileIds = (facilityFiles as FacilityFileWithStorage[]).map(ff => ff.file_id);
      if (fileIds.length > 0) {
        const { error: fileError } = await supabase.from('file').delete().in('id', fileIds);
        if (fileError) console.error('[Facility Delete] file delete error:', fileError);
      }
    }

    // Delete facility_images
    const { error: fImageError } = await supabase
      .from('facility_image')
      .delete()
      .eq('facility_id', facilityId);
    if (fImageError) console.error('[Facility Delete] facility_image delete error:', fImageError);

    // Delete the facility
    const { error: deleteError } = await supabase.from('facility').delete().eq('id', facilityId);

    if (deleteError) {
      console.error('[Facility Delete] Delete error:', deleteError);
      return NextResponse.json(
        { error: deleteError.message || 'Failed to delete facility' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Facility "${facility.name}" has been permanently deleted`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Facility Delete] Unexpected error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'An error occurred while deleting the facility',
      },
      { status: 500 }
    );
  }
}
