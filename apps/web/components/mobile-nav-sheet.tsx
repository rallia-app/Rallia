'use client';

import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Heart,
  Home as HomeIcon,
  Menu,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import LocaleToggle from './locale-toggle';
import ModeToggle from './mode-toggle';
import { SocialIcons } from './social-icons';
import ThemeLogo from './theme-logo';

type NavLink = {
  href: string;
  key: 'home' | 'games' | 'communities' | 'guides';
  icon: LucideIcon;
};

const navLinks: NavLink[] = [
  { href: '/', key: 'home', icon: HomeIcon },
  { href: '/games', key: 'games', icon: Trophy },
  { href: '/communities', key: 'communities', icon: Users },
  { href: '/guides', key: 'guides', icon: BookOpen },
];

/**
 * Only controls the trigger button color so it works against the host
 * header background. The sheet body adapts to the site theme (light or
 * dark) automatically via Tailwind `dark:` variants.
 */
export type TriggerTone = 'onDark' | 'onLight';

const triggerStyles: Record<TriggerTone, string> = {
  // For pages with a dark hero/video behind the header (e.g. landing).
  onDark: 'text-white hover:bg-white/10',
  // For pages with a light/theme-aware background behind the header.
  onLight: 'text-foreground hover:bg-foreground/5 dark:text-white dark:hover:bg-white/10',
};

export interface MobileNavSheetProps {
  trigger?: TriggerTone;
}

export default function MobileNavSheet({ trigger = 'onLight' }: MobileNavSheetProps) {
  const t = useTranslations('home.header');
  const tFooter = useTranslations('footer');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close when route changes
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock scroll + listen for ESC
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Trigger — hidden while sheet is open */}
      {!open && (
        <button
          type="button"
          className={cn(
            'md:hidden ml-auto inline-flex items-center justify-center size-11 rounded-xl transition-colors relative z-50',
            triggerStyles[trigger]
          )}
          aria-label="Open menu"
          aria-expanded={false}
          aria-controls="mobile-nav-sheet"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-6" strokeWidth={2.25} />
        </button>
      )}

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/30 dark:bg-black/40 backdrop-blur-sm"
            style={{ animation: 'nav-backdrop-in 200ms ease-out' }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Sheet — theme-aware: subtle light gradient in light mode,
              deep teal in dark mode */}
          <div
            id="mobile-nav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            className={cn(
              'md:hidden fixed inset-x-0 top-0 z-50 flex flex-col max-h-[100svh] overflow-y-auto rounded-b-3xl shadow-2xl',
              'text-foreground bg-gradient-to-b from-white via-[var(--primary-50)] to-white',
              'dark:text-white dark:from-[var(--primary-950)] dark:via-[#0a1816] dark:to-[#06100e]'
            )}
            style={{ animation: 'nav-sheet-in 320ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border dark:border-white/10">
              <ThemeLogo href="/" width={108} height={36} />
              <button
                type="button"
                className="inline-flex items-center justify-center size-11 rounded-xl transition-colors text-foreground/80 hover:text-foreground hover:bg-foreground/10 dark:text-white/90 dark:hover:text-white dark:hover:bg-white/10"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X className="size-6" strokeWidth={2.25} />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex flex-col gap-1.5 px-4 pt-6 pb-2">
              {navLinks.map((link, idx) => {
                const Icon = link.icon;
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.key}
                    href={link.href}
                    className={cn(
                      'group flex items-center gap-4 px-3 py-3.5 rounded-2xl transition-all opacity-0',
                      active
                        ? 'bg-[var(--primary-100)] ring-1 ring-[var(--primary-300)] text-foreground dark:bg-white/10 dark:ring-white/15 dark:text-white'
                        : 'text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] dark:text-white/85 dark:hover:text-white dark:hover:bg-white/[0.06]'
                    )}
                    style={{
                      animation: 'nav-item-in 360ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                      animationDelay: `${80 + idx * 50}ms`,
                    }}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center justify-center size-10 rounded-xl transition-colors ring-1',
                        active
                          ? 'bg-[var(--primary-500)]/20 ring-[var(--primary-400)]/40 text-[var(--primary-700)] shadow-sm shadow-[var(--primary-500)]/20 dark:bg-[var(--primary-500)]/45 dark:ring-[var(--primary-400)]/60 dark:text-white dark:shadow-[var(--primary-500)]/30'
                          : 'bg-foreground/[0.06] ring-foreground/[0.06] text-foreground/80 dark:bg-white/[0.12] dark:ring-white/10 dark:text-white'
                      )}
                    >
                      <Icon className="size-5" strokeWidth={2} />
                    </span>
                    <span className="flex-1 text-lg font-semibold">{t(`nav.${link.key}`)}</span>
                    <ArrowUpRight
                      className={cn(
                        'size-4 transition-all',
                        active
                          ? 'opacity-100 translate-x-0 text-foreground dark:text-white'
                          : 'opacity-60 -translate-x-1 text-foreground/70 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-foreground dark:text-white/70 dark:group-hover:text-white'
                      )}
                      strokeWidth={2.25}
                    />
                  </Link>
                );
              })}
            </nav>

            {/* Donate CTA — gradient is identity-colored, works in both modes */}
            <div
              className="px-4 pt-3 pb-6 opacity-0"
              style={{
                animation: 'nav-item-in 360ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                animationDelay: `${80 + navLinks.length * 50}ms`,
              }}
            >
              <Link
                href="/donate"
                className="group flex items-center justify-between gap-3 px-5 py-4 rounded-2xl font-semibold transition-all hover:shadow-xl hover:-translate-y-0.5 bg-gradient-to-r from-[var(--secondary-500)] to-[var(--secondary-600)] text-white shadow-lg shadow-[var(--secondary-500)]/30"
              >
                <span className="inline-flex items-center gap-3">
                  <Heart className="size-5" fill="currentColor" />
                  {t('nav.donate')}
                </span>
                <ArrowUpRight className="size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>

            {/* Socials */}
            <div
              className={cn(
                'mt-auto flex items-center justify-center gap-5 px-6 py-5 border-t border-border dark:border-white/10 opacity-0',
                '[&_a]:!text-foreground/60 [&_a]:hover:!text-foreground',
                'dark:[&_a]:!text-white/70 dark:[&_a]:hover:!text-white'
              )}
              style={{
                animation: 'nav-item-in 360ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                animationDelay: `${100 + navLinks.length * 50}ms`,
              }}
            >
              <SocialIcons className="gap-5" />
            </div>

            {/* Footer — copyright + controls */}
            <div
              className="flex items-center justify-between gap-3 px-6 py-5 border-t border-border dark:border-white/10 opacity-0"
              style={{
                animation: 'nav-item-in 360ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                animationDelay: `${140 + navLinks.length * 50}ms`,
              }}
            >
              <p className="m-0 leading-none text-xs text-foreground/60 dark:text-white/60">
                &copy; {new Date().getFullYear()} {tFooter('title')}
              </p>
              <div
                className={cn(
                  'flex items-center gap-1',
                  '[&_button]:!text-foreground/80 [&_button]:hover:!text-foreground [&_button]:hover:!bg-foreground/10',
                  'dark:[&_button]:!text-white dark:[&_button]:hover:!bg-white/10'
                )}
              >
                <LocaleToggle />
                <ModeToggle />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
