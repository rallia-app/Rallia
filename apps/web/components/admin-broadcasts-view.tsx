'use client';

import { useMemo } from 'react';
import { Megaphone, Mail, LayoutTemplate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { AdminEmailsView } from './admin-emails-view';
import { AdminAnnouncementComposer } from './admin-announcement-composer';
import { AdminCommunicationsView } from './admin-communications-view';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useAdminRole } from '@/components/admin-role-context';
import { canPerformAction } from '@/lib/admin-rbac';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SportOption {
  id: string;
  display_name: string;
}

/**
 * Unified admin broadcast surface: email broadcasts, in-app announcements, and
 * the read-only notification-template previews (formerly Communications). Which
 * tabs appear depends on role — only super_admins can send, so moderators see
 * just the Templates tab. The active tab is mirrored to ?tab= for deep links.
 */
export function AdminBroadcastsView({ sports }: { sports: SportOption[] }) {
  const t = useTranslations('admin.broadcasts');
  const role = useAdminRole();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const canSend = canPerformAction(role, 'broadcasts:send');

  const tabs = useMemo(
    () =>
      [
        canSend && { value: 'email', label: t('tabs.email'), icon: Mail },
        canSend && { value: 'announcement', label: t('tabs.announcement'), icon: Megaphone },
        { value: 'templates', label: t('tabs.templates'), icon: LayoutTemplate },
      ].filter((tab): tab is { value: string; label: string; icon: typeof Mail } => Boolean(tab)),
    [canSend, t]
  );

  const requested = searchParams.get('tab');
  const activeTab = tabs.some(tab => tab.value === requested)
    ? (requested as string)
    : tabs[0].value;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Moderators get a single tab — no tab bar needed.
  if (tabs.length === 1) {
    return <AdminCommunicationsView />;
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        {tabs.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className="gap-1.5">
            <Icon className="size-4" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      {canSend && (
        <TabsContent value="email" className="pt-6">
          <AdminEmailsView sports={sports} />
        </TabsContent>
      )}
      {canSend && (
        <TabsContent value="announcement" className="pt-6">
          <AdminAnnouncementComposer />
        </TabsContent>
      )}
      <TabsContent value="templates" className="pt-6">
        <AdminCommunicationsView />
      </TabsContent>
    </Tabs>
  );
}
