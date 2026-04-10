import { ModerationView } from '@/components/moderation-view';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.moderation');
  return {
    title: `${t('title')} - Rallia`,
    description: t('title'),
  };
}

export default async function AdminModerationPage() {
  const t = await getTranslations('admin.moderation');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
      </div>

      <ModerationView />
    </div>
  );
}
