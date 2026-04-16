import { Card, CardContent } from '@/components/ui/card';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { Settings } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.settings');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminSettingsPage() {
  await requireAdminRole(['super_admin']);
  const t = await getTranslations('admin.settings');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Settings className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground m-0">{t('comingSoon')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
