import { Button } from '@/components/ui/button';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import LocaleToggle from './locale-toggle';
import ModeToggle from './mode-toggle';
import ThemeLogo from './theme-logo';

export default async function Header() {
  const t = await getTranslations('home');

  return (
    <header className="flex w-full max-w-6xl mx-auto my-8 justify-between items-center gap-3 px-8">
      <ThemeLogo href="/" width={120} height={40} />
      <div className="flex items-center gap-3">
        <Button
          variant="default"
          className="button-scale hidden md:inline-flex bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white"
          asChild
        >
          <Link href="/beta">{t('header.ctaButton')}</Link>
        </Button>
        <LocaleToggle />
        <ModeToggle />
      </div>
    </header>
  );
}
