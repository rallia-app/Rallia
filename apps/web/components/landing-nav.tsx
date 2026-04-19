'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const navLinks = [
  { href: '/', key: 'home' },
  { href: '/games', key: 'games' },
  { href: '/communities', key: 'communities' },
] as const;

export default function LandingNav() {
  const t = useTranslations('home.header');
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-10">
      {navLinks.map(link => {
        const isActive =
          link.href === '/'
            ? pathname === '/'
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.key}
            href={link.href}
            className={cn(
              'relative text-base font-medium transition-colors py-1',
              'after:absolute after:bottom-0 after:left-0 after:h-[2px] after:rounded-full after:bg-white after:transition-all after:duration-200',
              isActive
                ? 'text-white after:w-full'
                : 'text-white/70 hover:text-white after:w-0 hover:after:w-full'
            )}
          >
            {t(`nav.${link.key}`)}
          </Link>
        );
      })}
      <Link
        href="/donate"
        className="px-4 py-1.5 rounded-full bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] text-white text-sm font-semibold transition-colors"
      >
        {t('nav.donate')}
      </Link>
    </nav>
  );
}
