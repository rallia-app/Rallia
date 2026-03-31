'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const navLinks = [
  { href: '/games', key: 'games' },
  { href: '/communities', key: 'communities' },
  { href: '/guides', key: 'guides' },
] as const;

export default function HeaderNav() {
  const t = useTranslations('home.header');
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-14">
      {navLinks.map(link => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.key}
            href={link.href}
            className={cn(
              'relative text-base font-medium transition-colors py-1',
              'after:absolute after:bottom-0 after:left-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-all after:duration-200',
              isActive
                ? 'text-foreground after:w-full'
                : 'text-muted-foreground hover:text-foreground after:w-0 hover:after:w-full'
            )}
          >
            {t(`nav.${link.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
