'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import MobileNavSheet from './mobile-nav-sheet';

const navLinks = [
  { href: '/', key: 'home' },
  { href: '/play', key: 'play' },
  { href: '/events', key: 'events' },
  { href: '/communities', key: 'communities' },
  { href: '/guides', key: 'guides' },
] as const;

export default function HeaderNav() {
  const t = useTranslations('home.header');
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-10">
        {navLinks.map(link => (
          <Link
            key={link.key}
            href={link.href}
            className={cn(
              'relative text-base font-medium transition-colors py-1',
              'after:absolute after:bottom-0 after:left-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-all after:duration-200',
              isActive(link.href)
                ? 'text-foreground after:w-full'
                : 'text-muted-foreground hover:text-foreground after:w-0 hover:after:w-full'
            )}
          >
            {t(`nav.${link.key}`)}
          </Link>
        ))}
        <Link
          href="/donate"
          className="px-4 py-1.5 rounded-full bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white text-sm font-semibold transition-colors"
        >
          {t('nav.donate')}
        </Link>
      </nav>

      {/* Mobile sheet — trigger adapts to the marketing page background */}
      <MobileNavSheet trigger="onLight" />
    </>
  );
}
