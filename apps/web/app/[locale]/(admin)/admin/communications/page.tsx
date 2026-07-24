import { getLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';

// The template previews moved into the unified Broadcasts hub.
export default async function AdminCommunicationsRedirect() {
  const locale = await getLocale();
  redirect({ href: '/admin/broadcasts?tab=templates', locale });
}
