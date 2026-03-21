import { Database } from '@/types';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * One-time endpoint to create the first super admin
 *
 * SECURITY:
 * 1. Protected by SUPER_ADMIN_SETUP_KEY env var (timing-safe comparison)
 * 2. Automatically disabled once any admin exists (one-time use)
 * 3. Must be explicitly enabled via ALLOW_SUPER_ADMIN_SETUP=true
 * 4. Logs creation to admin_audit_log
 *
 * Usage:
 *   POST /api/admin/create-super-admin
 *   Headers: { "X-Setup-Key": "your-setup-key-from-env" }
 *   Body: { "email": "admin@rallia.app", "role": "super_admin" }
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPER_ADMIN_SETUP_KEY = process.env.SUPER_ADMIN_SETUP_KEY;
const ALLOW_SUPER_ADMIN_SETUP = process.env.ALLOW_SUPER_ADMIN_SETUP === 'true';

export async function POST(request: NextRequest) {
  // Security check: Only allow if explicitly enabled
  if (!ALLOW_SUPER_ADMIN_SETUP) {
    return NextResponse.json({ error: 'Super admin setup is disabled' }, { status: 403 });
  }

  // Verify setup key with timing-safe comparison
  const setupKey = request.headers.get('X-Setup-Key');
  if (!SUPER_ADMIN_SETUP_KEY || !setupKey) {
    return NextResponse.json({ error: 'Invalid setup key' }, { status: 401 });
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(setupKey);
  const b = encoder.encode(SUPER_ADMIN_SETUP_KEY);
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Invalid setup key' }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { email, role = 'super_admin' } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Create admin client with service role
    const supabaseAdmin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // One-time use: reject if any admin already exists
    const { count, error: checkError } = await supabaseAdmin
      .from('admin')
      .select('*', { count: 'exact', head: true });

    if (checkError) {
      console.error('Error checking existing admins:', checkError);
      return NextResponse.json({ error: 'Failed to verify admin state' }, { status: 500 });
    }

    if (count && count > 0) {
      return NextResponse.json(
        { error: 'Setup already completed. Admins already exist.' },
        { status: 403 }
      );
    }

    // Check if user exists in auth
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: 'Failed to check existing users' }, { status: 500 });
    }

    const existingUser = users.users.find(u => u.email === email);
    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create user in Auth
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      });

      if (createError) {
        return NextResponse.json(
          { error: `Failed to create user: ${createError.message}` },
          { status: 500 }
        );
      }

      userId = newUser.user.id;
    }

    // Create/update profile
    const { error: profileError } = await supabaseAdmin.from('profile').upsert(
      {
        id: userId,
        email,
        first_name: 'Super',
        last_name: 'Admin',
        display_name: 'Admin',
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      return NextResponse.json(
        { error: `Failed to create profile: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Create admin record
    const { error: adminError } = await supabaseAdmin.from('admin').upsert(
      {
        id: userId,
        role,
        permissions: {},
        notes: 'Created via setup endpoint',
      },
      { onConflict: 'id' }
    );

    if (adminError) {
      return NextResponse.json(
        { error: `Failed to create admin: ${adminError.message}` },
        { status: 500 }
      );
    }

    // Audit log the super admin creation
    await supabaseAdmin.from('admin_audit_log').insert({
      admin_id: userId,
      action_type: 'create',
      entity_type: 'admin',
      entity_id: userId,
      metadata: { source: 'setup-endpoint', email },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Super admin created successfully',
        userId,
        email,
        role,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Super admin creation error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
