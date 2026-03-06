import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

async function authorize(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  facilityId: string
) {
  // Get the facility first to know which org it belongs to
  const { data: facility } = await supabase
    .from('facility')
    .select('organization_id')
    .eq('id', facilityId)
    .single();

  if (!facility) {
    return { error: 'Facility not found', status: 404 } as const;
  }

  // Platform admins have full access
  const userIsAdmin = await isAdmin(userId);
  if (userIsAdmin) {
    return { facility } as const;
  }

  // Otherwise check org membership
  const { data: membership } = await supabase
    .from('organization_member')
    .select('organization_id, role')
    .eq('user_id', userId)
    .eq('organization_id', facility.organization_id)
    .is('left_at', null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: 'Unauthorized', status: 401 } as const;
  }

  if (!['owner', 'admin'].includes(membership.role)) {
    return { error: 'Forbidden', status: 403 } as const;
  }

  return { facility } as const;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const auth = await authorize(supabase, user.id, id);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as unknown as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    const uploadedImages = [];

    // Get current max display_order for this facility
    const { data: existingImages } = await supabase
      .from('facility_image')
      .select('display_order')
      .eq('facility_id', id)
      .order('display_order', { ascending: false })
      .limit(1);

    let nextDisplayOrder =
      existingImages && existingImages.length > 0 ? (existingImages[0].display_order || 0) + 1 : 0;

    for (const file of files) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: `File ${file.name} is not an image` }, { status: 400 });
      }

      // Validate file size
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: `Image ${file.name} exceeds maximum size of 10MB` },
          { status: 400 }
        );
      }

      // Generate unique storage key
      const fileExt = file.name.split('.').pop() || 'jpg';
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 9);
      const fileName = `${id}/${timestamp}-${randomId}.${fileExt}`;
      // Path within the bucket (for upload/getPublicUrl)
      const storagePath = fileName;
      // Full storage key to store in DB (includes bucket prefix)
      const storageKey = `facility-images/${fileName}`;

      // Convert File to Blob
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Blob([arrayBuffer], { type: file.type });

      // Upload to storage (use path within bucket)
      const { error: uploadError } = await supabase.storage
        .from('facility-images')
        .upload(storagePath, fileData, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        return NextResponse.json(
          { error: `Failed to upload ${file.name}: ${uploadError.message}` },
          { status: 500 }
        );
      }

      // Get public URL (use path within bucket)
      const { data: urlData } = supabase.storage.from('facility-images').getPublicUrl(storagePath);

      // Insert into facility_image table
      const { data: imageRecord, error: insertError } = await supabase
        .from('facility_image')
        .insert({
          facility_id: id,
          storage_key: storageKey,
          url: urlData.publicUrl,
          file_size: file.size,
          mime_type: file.type,
          display_order: nextDisplayOrder++,
          is_primary: false, // Will be set manually or via update
        })
        .select()
        .single();

      if (insertError) {
        console.error('Database insert error:', insertError);
        // Try to clean up uploaded file (use path within bucket)
        await supabase.storage.from('facility-images').remove([storagePath]);
        return NextResponse.json(
          { error: `Failed to save image record: ${insertError.message}` },
          { status: 500 }
        );
      }

      uploadedImages.push(imageRecord);
    }

    return NextResponse.json({ images: uploadedImages });
  } catch (error) {
    console.error('Error uploading images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload images' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const auth = await authorize(supabase, user.id, id);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const imageId = searchParams.get('imageId');

    if (!imageId) {
      return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
    }

    // Get image record to get storage_key
    const { data: image, error: fetchError } = await supabase
      .from('facility_image')
      .select('storage_key')
      .eq('id', imageId)
      .eq('facility_id', id)
      .single();

    if (fetchError || !image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Extract path within bucket (remove bucket prefix if present)
    const storagePath = image.storage_key.startsWith('facility-images/')
      ? image.storage_key.replace('facility-images/', '')
      : image.storage_key;

    // Delete from storage (use path within bucket)
    const { error: storageError } = await supabase.storage
      .from('facility-images')
      .remove([storagePath]);

    if (storageError) {
      console.error('Storage delete error:', storageError);
      // Continue to delete DB record even if storage delete fails
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('facility_image')
      .delete()
      .eq('id', imageId)
      .eq('facility_id', id);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete image: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete image' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const auth = await authorize(supabase, user.id, id);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { imageId, display_order, is_primary, description } = body;

    if (!imageId) {
      return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (display_order !== undefined) updates.display_order = display_order;
    if (is_primary !== undefined) {
      updates.is_primary = is_primary;
      // If setting as primary, unset all other primary images for this facility
      if (is_primary) {
        await supabase
          .from('facility_image')
          .update({ is_primary: false })
          .eq('facility_id', id)
          .neq('id', imageId);
      }
    }
    if (description !== undefined) updates.description = description;

    const { error: updateError } = await supabase
      .from('facility_image')
      .update(updates)
      .eq('id', imageId)
      .eq('facility_id', id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update image: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating image:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update image' },
      { status: 500 }
    );
  }
}
