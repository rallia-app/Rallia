import { getTranslations } from 'next-intl/server';

export default async function GuidesPage() {
  const t = await getTranslations('home.header.nav');

  return (
    <div className="flex flex-col items-center justify-center w-full py-24 text-center">
      <h1 className="text-4xl font-bold">{t('guides')}</h1>
      <p className="mt-4 text-lg text-muted-foreground">Coming soon.</p>
    </div>
  );
}
