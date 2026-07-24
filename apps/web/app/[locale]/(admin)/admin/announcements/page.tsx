import { getLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';

// Announcements moved into the unified Broadcasts hub.
export default async function AdminAnnouncementsRedirect() {
  const locale = await getLocale();
  redirect({ href: '/admin/broadcasts?tab=announcement', locale });
}
