import { createClient } from '@/lib/supabase/server';
import { Database, Enums } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

type OrganizationNature = Enums<'organization_nature_enum'>;
type OrganizationType = Enums<'organization_type_enum'> | null;
type Country = Enums<'country_enum'> | null;
type OrganizationMemberRole = Database['public']['Tables']['organization_member']['Insert']['role'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate required fields
    if (!body.name || !body.type || !body.nature || !body.role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate email format if provided (mirror of validateEmail in
    // packages/shared-utils — the `.`-excluded middle class avoids the
    // overlap CodeQL flags as polynomial-ReDoS-prone).
    if (body.email) {
      const emailRegex = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
      if (!emailRegex.test(body.email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
      }
    }

    // Validate slug uniqueness
    const { data: existingOrg } = await supabase
      .from('organization')
      .select('id')
      .eq('slug', body.slug)
      .single();

    if (existingOrg) {
      // If slug exists, append a number
      let counter = 1;
      let newSlug = `${body.slug}-${counter}`;
      let slugExists = true;

      while (slugExists) {
        const { data: check } = await supabase
          .from('organization')
          .select('id')
          .eq('slug', newSlug)
          .single();

        if (!check) {
          slugExists = false;
        } else {
          counter++;
          newSlug = `${body.slug}-${counter}`;
        }
      }
      body.slug = newSlug;
    }

    // Create organization
    const { data: organization, error: orgError } = await supabase
      .from('organization')
      .insert({
        owner_id: user.id,
        name: body.name,
        nature: body.nature as OrganizationNature,
        email: body.email || null,
        phone: body.phone || null,
        slug: body.slug,
        address: body.address || null,
        city: body.city || null,
        country: body.country as Country,
        postal_code: body.postalCode || null,
        type: body.type as OrganizationType,
        description: body.description || null,
        website: body.website || null,
      })
      .select()
      .single();

    if (orgError) {
      console.error('Organization creation error:', orgError);
      return NextResponse.json(
        { error: orgError.message || 'Failed to create organization' },
        { status: 500 }
      );
    }

    // Create organization member record
    // Role should be 'owner' for organization creator
    const { error: memberError } = await supabase.from('organization_member').insert({
      user_id: user.id,
      organization_id: organization.id,
      role: body.role as OrganizationMemberRole,
    });

    if (memberError) {
      console.error('Organization member creation error:', memberError);
      // Try to delete the organization if member creation fails
      await supabase.from('organization').delete().eq('id', organization.id);
      return NextResponse.json(
        {
          error: memberError.message || 'Failed to create organization membership',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, organization }, { status: 201 });
  } catch (error) {
    console.error('Organization creation error:', error);
    return NextResponse.json(
      { error: 'An error occurred while creating the organization' },
      { status: 500 }
    );
  }
}
