import { AdminSignInForm } from '@/components/admin-sign-in-form';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.signIn');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; token?: string }>;
}) {
  const t = await getTranslations('admin.signIn');
  const locale = await getLocale();
  const supabase = await createClient();
  const params = await searchParams;

  const token = params.token;

  // Check if user is already authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If already authenticated, check if they're an admin
  if (user) {
    redirect(`/${locale}/admin/sign-in/post-auth?token=${token ? encodeURIComponent(token) : ''}`);
  }

  // Look up invitation email from token
  let invitationEmail: string | undefined;
  if (token) {
    const { data: invitation } = await supabase
      .from('invitation')
      .select('email')
      .eq('token', token)
      .single();

    if (invitation?.email) {
      invitationEmail = invitation.email;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
        <p className="text-sm text-muted-foreground">{t('restricted')}</p>
      </div>

      <AdminSignInForm initialError={params.error} initialEmail={invitationEmail} />
    </div>
  );
}
