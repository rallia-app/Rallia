import { getLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';

// Emails moved into the unified Broadcasts hub.
export default async function AdminEmailsRedirect() {
  const locale = await getLocale();
  redirect({ href: '/admin/broadcasts?tab=email', locale });
}
